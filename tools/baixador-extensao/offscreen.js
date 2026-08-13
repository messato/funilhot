// Documento offscreen: baixa um vídeo HLS (.m3u8) buscando cada segmento,
// descriptografando se for AES-128, costurando tudo num arquivo e salvando.

// blobs vivos aguardando o service worker terminar o download
const objUrls = new Map();

// envia mensagem sem quebrar se o destino estiver fechado
function safeSend(m) {
  try {
    const p = chrome.runtime.sendMessage(m);
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.action === "hlsDownload") {
    runHls(msg).catch((e) => {
      safeSend({
        target: "background",
        action: "hlsDone",
        jobId: msg.jobId,
        ok: false,
        error: String(e && e.message ? e.message : e),
      });
    });
  } else if (msg.action === "revoke" && msg.objUrl) {
    // o SW terminou de baixar: pode liberar o blob
    if (objUrls.has(msg.objUrl)) {
      URL.revokeObjectURL(msg.objUrl);
      objUrls.delete(msg.objUrl);
    }
  }
});

async function fetchText(url) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("HTTP " + r.status + " ao ler a playlist");
  return r.text();
}

async function fetchBuf(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
}

function absUrl(u, base) {
  try { return new URL(u, base).href; } catch (_) { return u; }
}

function parseAttrs(line) {
  // pega pares CHAVE=VALOR (com ou sem aspas) de uma tag EXT-X-*
  const out = {};
  const re = /([A-Z0-9\-]+)=("([^"]*)"|[^,]*)/g;
  let m;
  while ((m = re.exec(line))) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return out;
}

async function chooseMediaPlaylist(text, url) {
  if (!/#EXT-X-STREAM-INF/.test(text)) return { text, url };
  // master playlist: escolhe a variante de maior BANDWIDTH
  const lines = text.split(/\r?\n/);
  let best = null, bestBw = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const bw = parseInt(parseAttrs(lines[i]).BANDWIDTH || "0", 10) || 0;
      const uri = (lines[i + 1] || "").trim();
      if (uri && !uri.startsWith("#") && bw >= bestBw) { bestBw = bw; best = uri; }
    }
  }
  if (!best) return { text, url };
  const variantUrl = absUrl(best, url);
  return { text: await fetchText(variantUrl), url: variantUrl };
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/i, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function seqIV(seq) {
  const iv = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { iv[i] = seq & 0xff; seq = Math.floor(seq / 256); }
  return iv;
}

async function runHls({ jobId, url, filename, saveAs }) {
  const media = await chooseMediaPlaylist(await fetchText(url), url);
  const lines = media.text.split(/\r?\n/);

  const segments = [];
  let initSeg = null;
  let isFmp4 = false;
  let key = null; // {method, uri, iv}
  let seq = 0;
  // sequência de mídia inicial (p/ IV implícito)
  const seqMatch = media.text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  if (seqMatch) seq = parseInt(seqMatch[1], 10) || 0;

  let curSeq = seq;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-KEY")) {
      const a = parseAttrs(line);
      if ((a.METHOD || "").toUpperCase() === "NONE") key = null;
      else key = { method: (a.METHOD || "").toUpperCase(), uri: a.URI ? absUrl(a.URI, media.url) : null, iv: a.IV || null };
    } else if (line.startsWith("#EXT-X-MAP")) {
      const a = parseAttrs(line);
      if (a.URI) { initSeg = absUrl(a.URI, media.url); isFmp4 = true; }
    } else if (line && !line.startsWith("#")) {
      segments.push({ url: absUrl(line, media.url), key, seq: curSeq++ });
    }
  }

  if (!segments.length) throw new Error("Nenhum segmento encontrado na playlist HLS.");
  if (segments.length > 5000) throw new Error("Playlist muito longa (" + segments.length + " segmentos).");

  // importa chaves AES-128 (uma vez por URI)
  const keyCache = new Map();
  async function getCryptoKey(uri) {
    if (keyCache.has(uri)) return keyCache.get(uri);
    const raw = await fetchBuf(uri);
    const ck = await crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["decrypt"]);
    keyCache.set(uri, ck);
    return ck;
  }

  const parts = [];
  if (initSeg) parts.push(await fetchBuf(initSeg));

  const total = segments.length;
  for (let i = 0; i < total; i++) {
    const s = segments[i];
    let buf = await fetchBuf(s.url);
    if (s.key && s.key.method === "AES-128" && s.key.uri) {
      const ck = await getCryptoKey(s.key.uri);
      const iv = s.key.iv ? hexToBytes(s.key.iv) : seqIV(s.seq);
      try {
        const dec = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, ck, buf);
        buf = new Uint8Array(dec);
      } catch (_) {
        throw new Error("Falha ao descriptografar o HLS (AES-128) — este stream não é suportado. Tente a versão MP4 do vídeo.");
      }
    } else if (s.key && s.key.method && s.key.method !== "NONE") {
      throw new Error("Criptografia HLS não suportada: " + s.key.method);
    }
    parts.push(buf);
    if (i % 3 === 0 || i === total - 1) {
      // via background: mantém o service worker acordado e ele repassa ao popup
      safeSend({ target: "background", action: "hlsProgress", url, done: i + 1, total });
    }
  }

  const ext = isFmp4 ? "mp4" : "ts";
  const mime = isFmp4 ? "video/mp4" : "video/mp2t";
  const blob = new Blob(parts, { type: mime });
  const objUrl = URL.createObjectURL(blob);
  objUrls.set(objUrl, true);
  // rede de segurança: libera sozinho depois de 10 min mesmo sem confirmação
  setTimeout(() => {
    if (objUrls.has(objUrl)) { URL.revokeObjectURL(objUrl); objUrls.delete(objUrl); }
  }, 10 * 60 * 1000);

  // chrome.downloads NÃO existe no offscreen — só o service worker baixa.
  // Mandamos o blob pronto pra lá; ele confirma e pede o revoke depois.
  safeSend({ target: "background", action: "hlsBlobReady", jobId, objUrl, ext, filename, saveAs });
}
