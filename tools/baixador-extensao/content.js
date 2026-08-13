// Ponte entre a página e a extensão:
//  - recebe as URLs de vídeo que o inject.js (mundo MAIN) lê do JSON do site;
//  - acha <video>/<source> no DOM;
//  - manda o título da aba pra dar nome aos arquivos.
// Leve de propósito: observa só inserção de nós e trabalha em lote.

(function () {
  const seen = new Set();
  let pending = [];
  let flushTimer = null;

  function queue(url) {
    if (!url || seen.has(url)) return;
    if (url.startsWith("blob:") || url.startsWith("data:") || !/^https?:/i.test(url)) return;
    seen.add(url);
    pending.push(url);
    if (!flushTimer) flushTimer = setTimeout(flush, 300);
  }
  function flush() {
    flushTimer = null;
    if (!pending.length) return;
    const urls = pending;
    pending = [];
    try { chrome.runtime.sendMessage({ action: "mediaFoundBatch", urls, title: document.title || "" }); } catch (_) {}
  }

  // 1) URLs vindas do gancho de fetch/XHR (o que mais captura)
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "vdl-inject" || !Array.isArray(d.urls)) return;
    for (const u of d.urls) queue(u);
  });

  // 2) <video>/<source> já presentes no DOM
  function scanDom() {
    const vids = document.getElementsByTagName("video");
    for (const v of vids) {
      if (v.currentSrc) queue(v.currentSrc);
      if (v.src) queue(v.src);
      const s = v.querySelector("source[src]");
      if (s) queue(s.src);
    }
  }
  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scanDom(); }, 700);
  }

  scanDom();
  setTimeout(scanDom, 1500);
  setTimeout(scanDom, 3500);
  try {
    const mo = new MutationObserver(scheduleScan);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("beforeunload", () => mo.disconnect(), { once: true });
  } catch (_) {}

  // 3) re-scan sob demanda (botão de recarregar do popup)
  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg && msg.action === "rescan") { scanDom(); send && send({ ok: true }); }
  });

  // título (pode chegar antes de qualquer vídeo)
  function sendTitle() { try { chrome.runtime.sendMessage({ action: "setTitleForTab", title: document.title || "" }); } catch (_) {} }
  sendTitle();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sendTitle, { once: true });
})();
