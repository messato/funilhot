// Aplica na landing o conteúdo editado no painel (/api/settings): textos com
// [data-field], imagens (avatar/capa) servidas de /img, mural de depoimentos e
// selo de prova social (via /api/pulse). Sem valor salvo, mantém o HTML padrão.
(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ----- Depoimentos (mural) -----
  function renderTestimonials(list) {
    if (!list || !list.length) return;
    var host = document.querySelector('.conteudo');
    if (!host || document.getElementById('depo-dyn')) return;
    var stars = function (n) { n = Math.max(1, Math.min(5, n || 5)); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); };
    var cards = list.slice(0, 12).map(function (t) {
      var who = (t.name || 'Cliente') + (t.uf ? ' · ' + t.uf : '');
      return '<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:14px;margin-bottom:10px;text-align:left">' +
        '<div style="color:#ffce54;font-size:14px;letter-spacing:2px">' + stars(t.rating) + '</div>' +
        '<div style="margin:6px 0;font-size:14px;line-height:1.5">' + escapeHtml(t.text) + '</div>' +
        '<div style="color:#9aa;font-size:12px;font-weight:700">' + escapeHtml(who) + '</div></div>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.id = 'depo-dyn';
    wrap.style.cssText = 'margin-top:24px';
    wrap.innerHTML = '<h2 class="secao-titulo">O que dizem 💬</h2>' + cards;
    host.appendChild(wrap);
  }

  // ----- Prova social (selo flutuante, dados reais e anonimizados) -----
  function showPulse() {
    fetch('/api/pulse').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || j.enabled === false || !j.today) return;
      var msgs = ['🔥 <b>' + j.today + '</b> ' + (j.today === 1 ? 'compra' : 'compras') + ' nas últimas 24h'];
      if (j.lastHour) msgs.push('⚡ <b>' + j.lastHour + '</b> na última hora');
      (j.recent || []).slice(0, 4).forEach(function (r) { msgs.push('✅ Alguém de <b>' + escapeHtml(r.uf) + '</b> comprou há ' + r.minAgo + ' min'); });
      var bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:rgba(20,10,25,.92);color:#fff;border:1px solid rgba(255,105,180,.4);border-radius:12px;padding:10px 14px;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:80vw;backdrop-filter:blur(6px);transition:opacity .4s,transform .4s;transform:translateY(80px);opacity:0';
      document.body.appendChild(bar);
      var i = 0;
      (function cycle() {
        bar.innerHTML = msgs[i % msgs.length];
        bar.style.transform = 'translateY(0)'; bar.style.opacity = '1';
        i++;
        setTimeout(function () {
          bar.style.transform = 'translateY(80px)'; bar.style.opacity = '0';
          setTimeout(cycle, 500);
        }, 4500);
      })();
    }).catch(function () { /* silencioso */ });
  }

  fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok || !j.settings) return;
    var s = j.settings;
    document.querySelectorAll('[data-field]').forEach(function (el) {
      var v = s[el.getAttribute('data-field')];
      if (v != null && v !== '') el.textContent = v;
    });
    if (s.capaVer) { var c = document.querySelector('.capa'); if (c) c.src = '/img/capa?v=' + s.capaVer; }
    if (s.avatarVer) { var a = document.querySelector('.avatar'); if (a) a.src = '/img/avatar?v=' + s.avatarVer; }
    if (s.logoVer) { var lg = document.querySelector('.header img'); if (lg) lg.src = '/img/logo?v=' + s.logoVer; }
    renderTestimonials(s.testimonials);
  }).catch(function () { /* mantém o HTML padrão se falhar */ });

  showPulse();
})();
