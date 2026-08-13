// ============================================================
// Service worker: fareja os vídeos que passam pela rede em cada aba,
// mantém uma lista por aba e trata os downloads (direto ou HLS).
// ============================================================

// tabId -> { url -> {url, kind, type, size, title, ts} }
const mediaByTab = {};

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|mov|webm|mkv|ogv|ts|mp3|m4a|aac|wav|ogg|flac)(\?|#|$)/i;
const MEDIA_CT = /^(video\/|audio\/|application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml))/i;
const MAX_PER_TAB = 120;

function kindOf(url, contentType) {
  const u = url.toLowerCase();
  if (/\.m3u8(\?|#|$)/.test(u) || /mpegurl/.test(contentType || "")) return "hls";
  if (/\.mpd(\?|#|$)/.test(u) || /dash\+xml/.test(contentType || "")) return "dash";
  if (/^audio\//.test(contentType || "") || /\.(mp3|m4a|aac|wav|ogg|flac)(\?|#|$)/.test(u)) return "audio";
  return "video";
}

function guessName(url) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop() || "video";
    return decodeURIComponent(p).replace(/\.(m3u8|mpd|ts)$/i, "");
  } catch (_) {
    return "video";
  }
}

function updateBadge(tabId) {
  const n = mediaByTab[tabId] ? Object.keys(mediaByTab[tabId]).length : 0;
  const text = n > 0 ? String(Math.min(n, 99)) : "";
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#C92765" });
}

// Espelha a lista de cada aba em storage.session, pra sobreviver quando o
// service worker é encerrado por inatividade (~30s) e o popup abre depois.
// Throttle: junta rajadas de segmentos numa única gravação (evita I/O à toa).
const persistTimers = {};
function persist(tabId) {
  if (persistTimers[tabId]) return;
  persistTimers[tabId] = setTimeout(() => {
    persistTimers[tabId] = null;
    try {
      chrome.storage.session.set({ ["tab_" + tabId]: Object.values(mediaByTab[tabId] || {}) });
    } catch (_) {}
  }, 400);
}
function forgetTab(tabId) {
  delete mediaByTab[tabId];
  try { chrome.storage.session.remove("tab_" + tabId); } catch (_) {}
}

function addMedia(tabId, info) {
  if (tabId == null || tabId < 0 || !info || !info.url) return;
  if (info.url.startsWith("blob:") || info.url.startsWith("data:")) return;
  const bag = (mediaByTab[tabId] = mediaByTab[tabId] || {});
  const existing = bag[info.url];
  if (existing) {
    // completa infos que chegam depois (tamanho pelo header, título pelo content script)
    if (info.size && !existing.size) existing.size = info.size;
    if (info.title && !existing.title) existing.title = info.title;
    if (info.type && !existing.type) existing.type = info.type;
    persist(tabId);
    return;
  }
  if (Object.keys(bag).length >= MAX_PER_TAB) return;
  bag[info.url] = {
    url: info.url,
    kind: info.kind || kindOf(info.url, info.type),
    type: info.type || "",
    size: info.size || 0,
    title: info.title || "",
    name: guessName(info.url),
    ts: Date.now(),
  };
  updateBadge(tabId);
  persist(tabId);
}

// --- Sniffer de rede: pega tudo que "cheira" a mídia ---
// Só escutamos os tipos que importam (media/xhr/other) + main_frame p/ resetar.
// Isso evita rodar em imagem/css/js/fonte — o grosso das requisições — e deixa
// o navegador e o service worker bem mais leves.
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.type === "main_frame") {
      // navegou a aba: zera a lista daquela aba
      forgetTab(d.tabId);
      updateBadge(d.tabId);
      return;
    }
    if (d.type === "media" || MEDIA_EXT.test(d.url)) {
      addMedia(d.tabId, { url: d.url });
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame", "media", "xmlhttprequest", "other"] }
);

// Pelo cabeçalho da resposta pegamos content-type (mídia sem extensão) e tamanho
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.type === "main_frame" || d.tabId < 0) return;
    let ct = "", len = 0;
    for (const h of d.responseHeaders || []) {
      const n = h.name.toLowerCase();
      if (n === "content-type") ct = (h.value || "").toLowerCase();
      else if (n === "content-length") len = parseInt(h.value, 10) || 0;
    }
    const isMedia = MEDIA_CT.test(ct) || MEDIA_EXT.test(d.url) || d.type === "media";
    if (!isMedia) return;
    // ignora fragmentos minúsculos de streaming (segmentos .ts soltos) p/ não poluir,
    // mas mantém playlists (.m3u8/.mpd) e arquivos de tamanho relevante
    const isPlaylist = /\.(m3u8|mpd)(\?|#|$)/i.test(d.url) || /mpegurl|dash\+xml/.test(ct);
    if (!isPlaylist && len && len < 300 * 1024) return;
    addMedia(d.tabId, { url: d.url, type: ct, size: len });
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders"]
);

// --- Mensagens do popup e do content script ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "list") {
    const memItems = Object.values(mediaByTab[msg.tabId] || {});
    // funde memória (mais fresca) com o que ficou salvo na sessão
    chrome.storage.session.get("tab_" + msg.tabId, (res) => {
      const saved = (res && res["tab_" + msg.tabId]) || [];
      const map = new Map();
      for (const it of saved) map.set(it.url, it);
      for (const it of memItems) map.set(it.url, it);
      // rehidrata a memória se o worker tinha sido encerrado
      if (!mediaByTab[msg.tabId] && saved.length) {
        mediaByTab[msg.tabId] = {};
        for (const it of saved) mediaByTab[msg.tabId][it.url] = it;
      }
      const items = Array.from(map.values()).sort((a, b) => b.ts - a.ts);
      sendResponse({ items });
    });
    return true; // resposta assíncrona
  }

  if (msg.action === "mediaFound") {
    // veio de <video>/<source> encontrados no DOM pelo content script
    const tabId = sender.tab && sender.tab.id;
    addMedia(tabId, { url: msg.url, type: msg.contentType || "", title: msg.title || "" });
    return;
  }

  if (msg.action === "mediaFoundBatch") {
    // veio do gancho de fetch/XHR (URLs de vídeo lidas do JSON do IG/TikTok)
    const tabId = sender.tab && sender.tab.id;
    for (const url of msg.urls || []) addMedia(tabId, { url, title: msg.title || "" });
    return;
  }

  if (msg.action === "setTitleForTab") {
    const tabId = sender.tab && sender.tab.id;
    const bag = mediaByTab[tabId] || {};
    let touched = false;
    for (const it of Object.values(bag)) if (!it.title) { it.title = msg.title; touched = true; }
    if (touched) persist(tabId);
    return;
  }

  if (msg.action === "download") {
    handleDownload(msg).then(sendResponse).catch((e) =>
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
    );
    return true; // resposta assíncrona
  }

  if (msg.action === "clearTab") {
    forgetTab(msg.tabId);
    updateBadge(msg.tabId);
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === "analyze") {
    // dispara e responde JÁ: a rolagem roda na página e continua mesmo que o
    // popup feche (ao trocar de aba) ou que este service worker seja encerrado.
    startAnalyze(msg.tabId);
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === "stopAnalyze") {
    stopAnalyze(msg.tabId);
    sendResponse({ ok: true });
    return;
  }
});

// --- Análise: rolagem automática da página ---
// O estado vive em storage.session com um prazo (until). Assim o popup sabe que
// está rodando mesmo que o service worker tenha sido encerrado no meio.
const ANALYZE_MAX_MS = 40000;

function setAnalyzeUntil(tabId, until) {
  try { chrome.storage.session.set({ ["an_" + tabId]: { until } }); } catch (_) {}
}

async function startAnalyze(tabId) {
  setAnalyzeUntil(tabId, Date.now() + ANALYZE_MAX_MS);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: autoScrollInPage });
  } catch (_) {
    /* aba fechou/navegou, ou página protegida (chrome://) */
  }
  setAnalyzeUntil(tabId, 0);
}

function stopAnalyze(tabId) {
  setAnalyzeUntil(tabId, 0);
  chrome.scripting
    .executeScript({ target: { tabId }, func: () => { window.__vdlStopScroll = true; } })
    .catch(() => {});
}

// Injetada NA PÁGINA: rola até o fim até parar de crescer (ou até mandarem parar).
function autoScrollInPage() {
  return new Promise((resolve) => {
    if (window.__vdlScrolling) { resolve(0); return; }
    window.__vdlScrolling = true;
    window.__vdlStopScroll = false;
    const startY = window.scrollY;
    let last = -1, same = 0, i = 0;
    const end = (n) => {
      window.__vdlScrolling = false;
      window.scrollTo(0, startY);
      resolve(n);
    };
    const tick = () => {
      if (window.__vdlStopScroll) { end(i); return; }
      window.scrollTo(0, document.body.scrollHeight);
      i++;
      const h = document.body.scrollHeight;
      same = h === last ? same + 1 : 0;
      last = h;
      if (i >= 50 || same >= 4) { end(i); return; }
      setTimeout(tick, 700);
    };
    tick();
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
});

// --- Download ---
async function handleDownload({ url, filename, saveAs, kind }) {
  if (kind === "hls") {
    return downloadHls(url, filename, saveAs);
  }
  if (kind === "dash") {
    // DASH fragmentado não é costurável de forma confiável aqui.
    throw new Error("Stream DASH (.mpd): abra o vídeo e use a opção MP4 detectada, ou o baixador por linha de comando.");
  }
  const id = await chrome.downloads.download({
    url,
    filename,
    saveAs: !!saveAs,
    conflictAction: "uniquify",
  });
  return { ok: true, id };
}

// --- HLS via documento offscreen (fetch + costura dos segmentos) ---
let creatingOffscreen = null;

async function ensureOffscreen() {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) return;
  } catch (_) {}
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Baixar e costurar os segmentos de um vídeo em streaming (HLS).",
    })
    .catch((e) => {
      // corrida: se já existe, seguimos em frente
      if (!/single offscreen/i.test(String(e && e.message))) throw e;
    });
  await creatingOffscreen;
  creatingOffscreen = null;
}

const hlsWaiters = {};
let hlsSeq = 0;

async function downloadHls(url, filename, saveAs) {
  await ensureOffscreen();
  const jobId = "hls-" + ++hlsSeq;
  const done = new Promise((resolve) => (hlsWaiters[jobId] = resolve));
  chrome.runtime.sendMessage({ target: "offscreen", action: "hlsDownload", jobId, url, filename, saveAs });
  const result = await done;
  return result;
}

// respostas vindas do offscreen
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "background") return;
  if (msg.action === "hlsDone") {
    // só chega aqui em caso de ERRO (sucesso vem por hlsBlobReady)
    const w = hlsWaiters[msg.jobId];
    if (w) {
      w({ ok: msg.ok, id: msg.id, error: msg.error });
      delete hlsWaiters[msg.jobId];
    }
  } else if (msg.action === "hlsBlobReady") {
    // o offscreen costurou o vídeo; o download em si só o SW pode fazer
    const finalName = (msg.filename || "video").replace(/\.(ts|mp4)$/i, "") + "." + (msg.ext || "mp4");
    chrome.downloads
      .download({ url: msg.objUrl, filename: finalName, saveAs: !!msg.saveAs, conflictAction: "uniquify" })
      .then((id) => {
        const w = hlsWaiters[msg.jobId];
        if (w) { w({ ok: true, id }); delete hlsWaiters[msg.jobId]; }
        const onChanged = (delta) => {
          if (delta.id === id && delta.state && (delta.state.current === "complete" || delta.state.current === "interrupted")) {
            safeRuntimeSend({ target: "offscreen", action: "revoke", objUrl: msg.objUrl });
            chrome.downloads.onChanged.removeListener(onChanged);
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
      })
      .catch((err) => {
        const w = hlsWaiters[msg.jobId];
        if (w) { w({ ok: false, error: String(err && err.message ? err.message : err) }); delete hlsWaiters[msg.jobId]; }
        safeRuntimeSend({ target: "offscreen", action: "revoke", objUrl: msg.objUrl });
      });
  } else if (msg.action === "hlsProgress") {
    // repassa o progresso ao popup (se estiver aberto)
    safeRuntimeSend({ target: "popup", action: "hlsProgress", url: msg.url, done: msg.done, total: msg.total });
  }
});

function safeRuntimeSend(m) {
  try {
    const p = chrome.runtime.sendMessage(m);
    if (p && p.catch) p.catch(() => {});
  } catch (_) {}
}
