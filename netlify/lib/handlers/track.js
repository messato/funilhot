'use strict';

const { setJSON, dayKey } = require('../store');
const { rateLimit, clientIp } = require('../ratelimit');

// Beacon de tráfego das páginas do funil. Grava um evento por visualização.
const PAGES = new Set(['landing', 'checkout', 'upsell_oferta', 'downsell_oferta', 'pagamento', 'obrigado']);

const clean = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max).replace(/[<>"']/g, '') : '');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  if ((event.body || '').length > 1500) return { statusCode: 413, body: '' };
  if (!rateLimit('track:' + clientIp(event), { limit: 60, windowMs: 60000 }).ok) {
    return { statusCode: 429, body: '' };
  }

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: '' }; }

  const page = clean(p.page, 20);
  const vid = clean(p.vid, 40);
  if (!PAGES.has(page) || !/^[a-z0-9-]{8,40}$/.test(vid)) return { statusCode: 400, body: '' };

  const ts = Date.now();
  await setJSON(`ev/${dayKey(ts)}/${ts}-${Math.random().toString(16).slice(2, 8)}.json`, {
    e: 'view',
    page,
    vid,
    plan: clean(p.plan, 20),
    offer: clean(p.offer, 20),
    us: clean(p.us),   // utm_source
    um: clean(p.um),   // utm_medium
    uc: clean(p.uc),   // utm_campaign
    m: p.m ? 1 : 0,    // mobile
    ts,
  });

  return { statusCode: 204, body: '' };
};
