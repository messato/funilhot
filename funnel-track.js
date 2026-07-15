// Tracker do funil: identifica a página, guarda UTMs e envia um ping ao /api/track.
// Sem cookies de terceiros, sem serviços externos — tudo primeira parte.
(function () {
  var PAGE_MAP = {
    'index.html': 'landing',
    '': 'landing',
    'checkout.html': 'checkout',
    'upsell-mensal.html': 'upsell_oferta',
    'upsell-trimestral.html': 'upsell_oferta',
    'downsell-mensal.html': 'downsell_oferta',
    'downsell-trimestral.html': 'downsell_oferta',
    'upsell-checkout.html': 'pagamento',
    'obrigado.html': 'obrigado'
  };

  var file = location.pathname.split('/').pop();
  var page = PAGE_MAP[file];
  if (!page) return;

  // Visitante: id aleatório persistente neste navegador
  var vid = '';
  try {
    vid = localStorage.getItem('funil_vid') || '';
    if (!/^[a-z0-9-]{8,40}$/.test(vid)) {
      vid = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('funil_vid', vid);
    }
  } catch (e) { vid = 'v-anon-' + Math.random().toString(36).slice(2, 10); }

  // UTMs: capturadas na entrada e guardadas para atribuir a venda à origem
  var params = new URLSearchParams(location.search);
  var utm = {};
  try {
    utm = JSON.parse(localStorage.getItem('funil_utm') || '{}');
    var found = false;
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
      if (params.get(k)) { utm[k] = params.get(k).slice(0, 80); found = true; }
    });
    if (found) localStorage.setItem('funil_utm', JSON.stringify(utm));
  } catch (e) { /* localStorage indisponível não bloqueia nada */ }

  var payload = JSON.stringify({
    page: page,
    vid: vid,
    plan: (params.get('plan') || '').slice(0, 20),
    offer: (params.get('offer') || '').slice(0, 20),
    us: utm.utm_source || '',
    um: utm.utm_medium || '',
    uc: utm.utm_campaign || '',
    m: /Mobi|Android/i.test(navigator.userAgent) ? 1 : 0
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    }
  } catch (e) { /* métricas nunca podem quebrar a página */ }
})();
