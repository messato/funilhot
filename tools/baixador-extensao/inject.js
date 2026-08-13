// Roda no MUNDO DA PÁGINA (world: MAIN), antes dos scripts do site.
// Ele "escuta" as respostas JSON que o app do Instagram/TikTok/etc. recebe e
// extrai as URLs de vídeo de dentro delas — assim capturamos os vídeos SEM
// precisar dar play em cada um. Manda o que achar pro content.js via postMessage.

(function () {
  if (window.__vdlHooked) return;
  window.__vdlHooked = true;

  const posted = new Set();

  function extract(text) {
    if (!text || typeof text !== "string" || text.length > 8_000_000) return;
    // desescapa barras e unicode comuns em JSON ("https:\/\/", "\u0026")
    let s = text;
    if (s.indexOf("\\/") >= 0) s = s.replace(/\\\//g, "/");
    if (s.indexOf("\\u0026") >= 0) s = s.replace(/\\u0026/gi, "&");
    if (s.indexOf("\\u002F") >= 0) s = s.replace(/\\u002F/gi, "/");

    const found = [];
    // arquivos de vídeo diretos (video_versions do IG, mp4 do TikTok, etc.)
    const reFile = /https?:\/\/[^\s"'<>\\)]+?\.(?:mp4|m3u8|mov|webm)(?:\?[^\s"'<>\\)]*)?/gi;
    let m;
    while ((m = reFile.exec(s))) found.push(m[0]);
    // TikTok/alguns players expõem em campos "playAddr"/"downloadAddr"/"src"
    const reField = /"(?:playAddr|downloadAddr|contentUrl|video_url|src)"\s*:\s*"(https?:\/\/[^"\\]+)"/gi;
    while ((m = reField.exec(s))) found.push(m[1]);

    const fresh = [];
    for (let u of found) {
      u = u.replace(/&amp;/g, "&");
      if (!posted.has(u)) { posted.add(u); fresh.push(u); }
      if (posted.size > 4000) posted.clear(); // trava de segurança
    }
    if (fresh.length) {
      window.postMessage({ source: "vdl-inject", urls: fresh }, "*");
    }
  }

  // ---- hook do fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      const p = origFetch.apply(this, arguments);
      try {
        p.then((res) => {
          try {
            const ct = (res.headers && res.headers.get("content-type")) || "";
            if (/json|javascript|text\/plain/i.test(ct)) {
              res.clone().text().then(extract).catch(() => {});
            }
          } catch (_) {}
        }).catch(() => {});
      } catch (_) {}
      return p;
    };
  }

  // ---- hook do XMLHttpRequest ----
  const OX = XMLHttpRequest.prototype.open;
  const SX = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__vdlUrl = url;
    return OX.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      this.addEventListener("load", function () {
        try {
          const rt = this.responseType;
          if (rt === "" || rt === "text") {
            const ct = this.getResponseHeader && this.getResponseHeader("content-type");
            if (!ct || /json|javascript|text/i.test(ct)) extract(this.responseText);
          } else if (rt === "json" && this.response) {
            extract(JSON.stringify(this.response));
          }
        } catch (_) {}
      });
    } catch (_) {}
    return SX.apply(this, arguments);
  };
})();
