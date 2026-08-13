// Popup: renderiza NA HORA (lê a lista direto do storage.session, sem esperar
// o service worker acordar) e só depois busca atualizações ao vivo.

const $ = (id) => document.getElementById(id);
const els = {
  host: $("host"), list: $("list"), empty: $("empty"), count: $("count"),
  seg: $("seg"), segAsk: $("segAsk"), segFolder: $("segFolder"),
  subfolder: $("subfolder"), hint: $("hint"),
  manualUrl: $("manualUrl"), manualBtn: $("manualBtn"),
  all: $("all"), clear: $("clear"), opts: $("opts"),
  reload: $("reload"), analyze: $("analyze"), detach: $("detach"),
};

const DEFAULTS = { mode: "folder", subfolder: "Videos" };
let opts = { ...DEFAULTS };
let tab = null;
let items = [];
const rowByUrl = new Map();

// ---------- destino (segmented) ----------
function applyMode(mode) {
  opts.mode = mode;
  els.seg.classList.toggle("folder", mode === "folder");
  els.segAsk.classList.toggle("on", mode === "ask");
  els.segFolder.classList.toggle("on", mode === "folder");
  els.hint.innerHTML = mode === "ask"
    ? "Abre a janela “Salvar como” — escolha <b>qualquer pasta</b> do computador."
    : "Salva direto, sem perguntar. O Chrome só grava fora de <b>Downloads</b> pela janela “Salvar como”.";
}
function saveOpts() {
  opts.subfolder = els.subfolder.value.trim();
  chrome.storage.local.set({ mode: opts.mode, subfolder: opts.subfolder });
}
els.segAsk.addEventListener("click", () => { applyMode("ask"); saveOpts(); });
els.segFolder.addEventListener("click", () => { applyMode("folder"); saveOpts(); els.subfolder.focus(); });
els.subfolder.addEventListener("input", saveOpts);
els.opts.addEventListener("click", () => chrome.runtime.openOptionsPage());

// ---------- util ----------
function esc(s){ return String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function humanSize(n){ if(!n) return ""; const u=["B","KB","MB","GB"]; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++;} return v.toFixed(v<10&&i>0?1:0)+" "+u[i]; }
function host(url){ try { return new URL(url).host.replace(/^www\./,""); } catch(_){ return ""; } }
function sanitize(name){ return (name||"video").replace(/[\\/:*?"<>| -]+/g," ").replace(/\s+/g," ").trim().slice(0,80)||"video"; }
function extOf(url,kind){ if(kind==="hls")return "mp4"; const m=url.split("?")[0].match(/\.([a-z0-9]{2,4})$/i); return m?m[1].toLowerCase():"mp4"; }
function baseName(it){ return sanitize(it.title || it.name || "video"); }
function buildFilename(it, withExt){
  const sub = opts.mode === "folder" && opts.subfolder
    ? opts.subfolder.replace(/^\/+|\/+$/g,"").replace(/\.\.+/g,"").replace(/[\\:*?"<>|\u0000-\u001f]+/g,"").replace(/\/+/g,"/") + "/"
    : "";
  return sub + baseName(it) + (withExt ? "." + extOf(it.url, it.kind) : "");
}
const KIND = { video:{c:"",t:"MP4"}, hls:{c:"hls",t:"HLS"}, audio:{c:"audio",t:"MP3"}, dash:{c:"dash",t:"DASH"} };

// ---------- render ----------
function render() {
  const has = items.length > 0;
  els.empty.hidden = has;
  els.all.hidden = !has;
  els.clear.hidden = !has;
  els.count.textContent = has ? (items.length + (items.length===1?" vídeo":" vídeos") + " nesta aba") : "Nenhum vídeo ainda";
  rowByUrl.clear();
  els.list.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const it of items) {
    const k = KIND[it.kind] || KIND.video;
    const li = document.createElement("li");
    li.className = "item";
    const bits = [];
    if (it.size) bits.push(humanSize(it.size));
    const h = host(it.url); if (h) bits.push(h);
    li.innerHTML =
      '<div class="chip '+k.c+'"><span class="kind">'+k.t+'</span></div>' +
      '<div class="meta">' +
        '<div class="name">'+esc(baseName(it))+'</div>' +
        '<div class="detail">'+esc(bits.join(" · "))+'</div>' +
        '<div class="progress"><i></i></div>' +
      '</div>' +
      '<button class="dl"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/></svg>Baixar</button>';
    li.querySelector(".dl").addEventListener("click", (e) => startDownload(it, li, e.currentTarget));
    rowByUrl.set(it.url, li);
    frag.appendChild(li);
  }
  els.list.appendChild(frag);
}

// ---------- download ----------
function setBtnLabel(btn, text) {
  const last = btn.childNodes[btn.childNodes.length - 1];
  if (last && last.nodeType === Node.TEXT_NODE) last.textContent = text;
}
async function startDownload(item, li, btn) {
  const filename = buildFilename(item, item.kind !== "hls");
  const saveAs = opts.mode === "ask";
  if (item.kind === "hls") { li.classList.add("busy"); setProgress(li, 4); }
  if (btn) { btn.disabled = true; btn.classList.add("spin"); setBtnLabel(btn, item.kind === "hls" ? "…" : ""); }
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ action:"download", url:item.url, filename, saveAs, kind:item.kind });
  } catch (e) { resp = { ok:false, error:String(e) }; }
  li.classList.remove("busy");
  if (btn) { btn.disabled = false; btn.classList.remove("spin"); setBtnLabel(btn, "Baixar"); }
  toast(resp && resp.ok ? (item.kind==="hls"?"Vídeo montado e salvo":"Download iniciado") : ("Erro: " + (resp&&resp.error?resp.error:"falhou")), !(resp&&resp.ok));
}
function setProgress(li, pct){ const b=li.querySelector(".progress > i"); if(b) b.style.width=Math.max(0,Math.min(100,pct))+"%"; }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === "popup" && msg.action === "hlsProgress") {
    const li = rowByUrl.get(msg.url);
    if (li) { li.classList.add("busy"); setProgress(li, msg.total ? (msg.done/msg.total)*100 : 5); }
  }
});

// ---------- lista ----------
function itemsFromSession(cb) {
  chrome.storage.session.get("tab_" + tab.id, (res) => {
    cb((res && res["tab_" + tab.id]) || []);
  });
}
function setItems(next) {
  const changed = next.length !== items.length || next.some((x,i)=>!items[i]||items[i].url!==x.url||items[i].size!==x.size);
  items = next.slice().sort((a,b)=>b.ts-a.ts);
  if (changed) render();
}
async function refreshLive() {
  try {
    const resp = await chrome.runtime.sendMessage({ action:"list", tabId: tab.id });
    if (resp && resp.items) setItems(resp.items);
  } catch (_) { /* service worker acordando; a próxima passa pega */ }
}

// ---------- ações ----------
els.all.addEventListener("click", async () => {
  for (const li of els.list.querySelectorAll(".item")) {
    const btn = li.querySelector(".dl");
    if (btn && !btn.disabled) { btn.click(); await sleep(450); }
  }
});
els.clear.addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ action:"clearTab", tabId: tab.id }); } catch(_) {}
  setItems([]);
});
// recarregar: re-varre o DOM da página e atualiza a lista já
els.reload.addEventListener("click", async () => {
  els.reload.classList.add("spin");
  try { chrome.tabs.sendMessage(tab.id, { action: "rescan" }); } catch (_) {}
  await refreshLive();
  setTimeout(() => els.reload.classList.remove("spin"), 650);
});

// Analisar: a rolagem roda NA PÁGINA (disparada pelo background), então ela
// CONTINUA mesmo que este popup feche — inclusive ao trocar de aba.
const aLabel = els.analyze.querySelector(".a-label");
const aNote = els.analyze.querySelector(".a-note");
let analyzing = false;
let analyzeBase = 0;

els.analyze.addEventListener("click", async () => {
  if (analyzing) {
    try { await chrome.runtime.sendMessage({ action: "stopAnalyze", tabId: tab.id }); } catch (_) {}
    paintAnalyze(false);
    return;
  }
  analyzeBase = items.length;
  try { await chrome.runtime.sendMessage({ action: "analyze", tabId: tab.id }); } catch (_) {}
  paintAnalyze(true);
});

function paintAnalyze(on) {
  analyzing = on;
  els.analyze.classList.toggle("scanning", on);
  aLabel.textContent = on ? "Parar análise" : "Analisar página";
  if (!on) aNote.textContent = "rola e capta tudo";
}

// lê o estado da análise (vale mesmo com o popup fechado / worker dormindo)
function pollAnalyze() {
  chrome.storage.session.get("an_" + tab.id, (res) => {
    const st = (res && res["an_" + tab.id]) || null;
    const on = !!(st && st.until && Date.now() < st.until);
    if (on !== analyzing) {
      if (!on && analyzing) {
        const gained = items.length - analyzeBase;
        toast(gained > 0 ? ("+" + gained + " vídeo" + (gained === 1 ? "" : "s")) : "Análise concluída");
      }
      paintAnalyze(on);
    }
    if (on) aNote.textContent = items.length + " achados";
  });
}

els.manualBtn.addEventListener("click", doManual);
els.manualUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") doManual(); });
async function doManual() {
  const url = els.manualUrl.value.trim();
  if (!/^https?:\/\//i.test(url)) { toast("Cole um link http(s) válido.", true); return; }
  const kind = /\.m3u8(\?|#|$)/i.test(url) ? "hls" : /\.mpd(\?|#|$)/i.test(url) ? "dash" : "video";
  const fake = { url, kind, title:"", name:(url.split("/").pop()||"video").split("?")[0] };
  const filename = buildFilename(fake, kind !== "hls");
  els.manualBtn.disabled = true;
  let resp; try { resp = await chrome.runtime.sendMessage({ action:"download", url, filename, saveAs: opts.mode==="ask", kind }); } catch(e){ resp={ok:false,error:String(e)}; }
  els.manualBtn.disabled = false;
  if (resp && resp.ok) els.manualUrl.value = "";
  toast(resp && resp.ok ? "Download iniciado" : ("Erro: " + (resp&&resp.error?resp.error:"falhou")), !(resp&&resp.ok));
}

// ---------- toast ----------
let toastEl=null, toastTimer=null;
function toast(text, isErr) {
  if (!toastEl){ toastEl=document.createElement("div"); toastEl.className="toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.toggle("err", !!isErr);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.remove("show"), 2600);
}
const sleep = (ms) => new Promise((r)=>setTimeout(r, ms));

// ---------- janela separada (não fecha ao trocar de aba) ----------
const params = new URLSearchParams(location.search);
const windowed = params.get("win") === "1";
if (windowed) {
  document.documentElement.classList.add("windowed");
  els.detach.hidden = true;
}
els.detach.addEventListener("click", async () => {
  await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?win=1&tab=" + tab.id),
    type: "popup",
    width: 400,
    height: 720,
  });
  window.close();
});

// ---------- init (rápido: nada bloqueia a primeira pintura) ----------
(async function init() {
  // opções e destino: local é instantâneo
  chrome.storage.local.get(DEFAULTS, (o) => {
    opts = { mode:o.mode||"folder", subfolder:o.subfolder??"" };
    els.subfolder.value = opts.subfolder;
    applyMode(opts.mode);
  });

  // Em janela separada, a aba-alvo vem na URL (a aba "ativa" seria a própria janela).
  const pinned = parseInt(params.get("tab") || "", 10);
  if (windowed && pinned) {
    try { tab = await chrome.tabs.get(pinned); } catch (_) { tab = null; }
    if (!tab) {
      els.host.textContent = "aba fechada";
      els.count.textContent = "A aba analisada foi fechada";
      return;
    }
  } else {
    const [t] = await chrome.tabs.query({ active:true, currentWindow:true });
    tab = t;
  }
  els.host.textContent = host(tab.url) || "esta aba";

  // 1) pinta JÁ com o cache da sessão (não acorda o service worker)
  itemsFromSession((cached) => setItems(cached));
  // 2) busca ao vivo e passa a atualizar
  refreshLive();
  pollAnalyze();
  setInterval(() => { refreshLive(); pollAnalyze(); }, 1200);
})();
