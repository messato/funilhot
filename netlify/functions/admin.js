'use strict';

const crypto = require('crypto');
const { getJSON, setJSON, listKeys, storageKind, dayKey } = require('../lib/store');
const { listOrders } = require('../lib/orders');
const { getConfig } = require('../lib/provider');
const { formatBRL } = require('../lib/catalog');
const { rateLimit, clientIp } = require('../lib/ratelimit');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, payload, headers = JSON_HEADERS) => ({
  statusCode,
  headers,
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

function authorized(event) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false; // sem senha configurada, painel fica fechado
  const given = (event.headers && (event.headers['x-admin-key'] || event.headers['X-Admin-Key'])) || '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const DAY_MS = 24 * 3600 * 1000;

function emptyDayAgg(day) {
  return {
    day,
    views: {},          // page -> count
    uniques: 0,
    mobile: 0,
    desktop: 0,
    pix: {},            // offer -> count (PIX gerados)
    pago: {},           // offer -> count (pagos)
    revenue: 0,         // centavos pagos no dia
    utm: {},            // source -> { views, pago, revenue }
  };
}

async function aggregateDay(day) {
  const agg = emptyDayAgg(day);
  const keys = await listKeys(`ev/${day}/`);
  const events = await Promise.all(keys.map((k) => getJSON(k)));
  const vids = new Set();

  for (const ev of events) {
    if (!ev) continue;
    const source = ev.us || '(direto)';
    agg.utm[source] = agg.utm[source] || { views: 0, pago: 0, revenue: 0, campaign: ev.uc || '' };

    if (ev.e === 'view') {
      agg.views[ev.page] = (agg.views[ev.page] || 0) + 1;
      if (ev.vid) vids.add(ev.vid);
      if (ev.m) agg.mobile += 1; else agg.desktop += 1;
      agg.utm[source].views += 1;
    } else if (ev.e === 'pix') {
      agg.pix[ev.offer] = (agg.pix[ev.offer] || 0) + 1;
    } else if (ev.e === 'pago') {
      agg.pago[ev.offer] = (agg.pago[ev.offer] || 0) + 1;
      agg.revenue += ev.amount || 0;
      agg.utm[source].pago += 1;
      agg.utm[source].revenue += ev.amount || 0;
    }
  }
  agg.uniques = vids.size;
  return agg;
}

// Dias passados são agregados uma vez e guardados; o dia atual é sempre ao vivo.
async function dayAgg(day) {
  const today = dayKey();
  if (day !== today) {
    const cached = await getJSON(`rollup/${day}.json`);
    if (cached) return cached;
  }
  const agg = await aggregateDay(day);
  if (day !== today) await setJSON(`rollup/${day}.json`, agg);
  return agg;
}

function daysBack(n, endTs = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(endTs - i * DAY_MS));
  return out;
}

const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0);

function kpisFrom(aggs, orders) {
  const paid = orders.filter((o) => o.status === 'paid');
  const gross = paid.reduce((a, o) => a + o.amount, 0);
  const net = paid.reduce((a, o) => a + (o.netAmount || o.amount), 0);
  const pixCount = orders.length;
  return {
    gross,
    net,
    paidCount: paid.length,
    pixCount,
    ticket: paid.length ? Math.round(gross / paid.length) : 0,
    pixConversion: pixCount ? Math.round((paid.length / pixCount) * 100) : 0,
    visits: aggs.reduce((a, d) => a + (d.views.landing || 0), 0),
    uniques: aggs.reduce((a, d) => a + d.uniques, 0),
  };
}

async function summary(days) {
  const now = Date.now();
  const currDays = daysBack(days);
  const prevDays = daysBack(days, now - days * DAY_MS);

  const [currAggs, prevAggs, currOrders, prevOrdersAll] = await Promise.all([
    Promise.all(currDays.map(dayAgg)),
    Promise.all(prevDays.map(dayAgg)),
    listOrders(now - days * DAY_MS),
    listOrders(now - 2 * days * DAY_MS),
  ]);
  const prevOrders = prevOrdersAll.filter((o) => o.createdAt < now - days * DAY_MS);

  // Funil agregado do período
  const v = (page) => currAggs.reduce((a, d) => a + (d.views[page] || 0), 0);
  const pix = (offer) => currAggs.reduce((a, d) => a + (d.pix[offer] || 0), 0);
  const pago = (offer) => currAggs.reduce((a, d) => a + (d.pago[offer] || 0), 0);

  const funnel = [
    { step: 'Visitas na página de vendas', count: v('landing') },
    { step: 'Abriram o checkout', count: v('checkout') },
    { step: 'Geraram PIX', count: pix('checkout') },
    { step: 'Pagaram (venda principal)', count: pago('checkout') },
    { step: 'Viram upsell', count: v('upsell_oferta') },
    { step: 'Pagaram upsell', count: pago('upsell') },
    { step: 'Viram downsell', count: v('downsell_oferta') },
    { step: 'Pagaram downsell', count: pago('downsell') },
  ];
  funnel.forEach((f, i) => {
    const base = i === 0 ? f.count : funnel[i - 1].count;
    f.rate = base ? Math.round((f.count / base) * 100) : 0;
  });

  // Vendas por produto
  const products = {};
  for (const o of currOrders.filter((x) => x.status === 'paid')) {
    const key = `${o.offer}/${o.plan}`;
    products[key] = products[key] || { label: o.label, paid: 0, revenue: 0 };
    products[key].paid += 1;
    products[key].revenue += o.amount;
  }

  // Origens (UTM)
  const utm = {};
  for (const d of currAggs) {
    for (const [source, s] of Object.entries(d.utm)) {
      utm[source] = utm[source] || { views: 0, pago: 0, revenue: 0, campaign: s.campaign };
      utm[source].views += s.views;
      utm[source].pago += s.pago;
      utm[source].revenue += s.revenue;
    }
  }

  return {
    ok: true,
    generatedAt: now,
    days,
    storage: await storageKind(),
    provider: getConfig().enabled ? 'assetpay' : 'stub',
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    kpis: kpisFrom(currAggs, currOrders),
    prevKpis: kpisFrom(prevAggs, prevOrders),
    daily: currAggs.map((d) => ({
      day: d.day,
      revenue: d.revenue,
      pago: sum(d.pago),
      pix: sum(d.pix),
      visits: d.views.landing || 0,
      uniques: d.uniques,
      mobile: d.mobile,
      desktop: d.desktop,
    })),
    funnel,
    products: Object.entries(products).map(([k, p]) => ({ key: k, ...p }))
      .sort((a, b) => b.revenue - a.revenue),
    utm: Object.entries(utm).map(([source, s]) => ({ source, ...s }))
      .sort((a, b) => b.views - a.views).slice(0, 25),
  };
}

function csvEscape(value) {
  let s = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita injeção de fórmula no Excel
  return `"${s.replace(/"/g, '""')}"`;
}

function toCSV(orders) {
  const header = ['id', 'produto', 'valor', 'status', 'nome', 'email', 'telefone', 'origem', 'campanha', 'criado_em', 'pago_em'];
  const rows = orders.map((o) => [
    o.id, o.label, (o.amount / 100).toFixed(2).replace('.', ','), o.status,
    o.nome, o.email, o.telefone, o.utmSource || '', o.utmCampaign || '',
    new Date(o.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    o.paidAt ? new Date(o.paidAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
  ].map(csvEscape).join(';'));
  return '﻿' + [header.join(';'), ...rows].join('\r\n');
}

exports.handler = async function (event) {
  if (!rateLimit('admin:' + clientIp(event), { limit: 120, windowMs: 60000 }).ok) {
    return reply(429, { ok: false, error: 'rate_limited' });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return reply(503, { ok: false, error: 'admin_not_configured' });
  }
  if (!authorized(event)) {
    return reply(401, { ok: false, error: 'unauthorized' });
  }

  const match = (event.path || '').match(/\/admin\/?([^/?]*)/);
  const route = match ? match[1] : '';
  const q = event.queryStringParameters || {};
  const days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 30));

  try {
    if (route === 'summary') {
      return reply(200, await summary(days));
    }

    if (route === 'orders') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      const filtered = q.status ? orders.filter((o) => o.status === q.status) : orders;
      return reply(200, {
        ok: true,
        orders: filtered.slice(0, 500).map((o) => ({ ...o, price: formatBRL(o.amount) })),
      });
    }

    if (route === 'abandoned') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      const cutoff = Date.now() - 10 * 60 * 1000;
      const abandoned = orders.filter((o) => o.status !== 'paid' && o.createdAt < cutoff);
      return reply(200, {
        ok: true,
        abandoned: abandoned.slice(0, 500).map((o) => ({ ...o, price: formatBRL(o.amount) })),
      });
    }

    if (route === 'export.csv') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      return reply(200, toCSV(orders), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pedidos-${dayKey()}.csv"`,
      });
    }

    if (route === 'ping') {
      return reply(200, { ok: true });
    }

    return reply(404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('admin error:', error.message);
    return reply(500, { ok: false, error: 'internal' });
  }
};
