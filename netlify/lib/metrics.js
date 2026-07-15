'use strict';

// Agregação de métricas do funil. Compartilhado entre o painel /admin e o
// resumo diário agendado. Lê eventos (ev/) e pedidos (orders/) do store.

const { getJSON, setJSON, listKeys, storageKind, storageError, dayKey } = require('./store');
const { listOrders } = require('./orders');
const { getConfig } = require('./provider');

const DAY_MS = 24 * 3600 * 1000;

// ---------- utilidades de data (fuso de Brasília) ----------
function daysBack(n, endTs = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(endTs - i * DAY_MS));
  return out;
}
function monthKey(ts = Date.now()) { return dayKey(ts).slice(0, 7); }
function monthStartTs(month) { return Date.parse(month + '-01T03:00:00Z'); } // 00h BRT
function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
// hora e dia-da-semana no fuso de Brasília
function brtParts(ts) {
  const d = new Date(ts - 3 * 3600 * 1000);
  return { hour: d.getUTCHours(), weekday: d.getUTCDay() }; // 0=domingo
}

const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0);

// ---------- gasto de tráfego (ROAS) ----------
// spend/<dia>.json = { "<origem>": centavos, ... }
async function setSpend(day, source, amountCents) {
  const key = `spend/${day}.json`;
  const cur = (await getJSON(key)) || {};
  const src = source || '(geral)';
  if (amountCents > 0) cur[src] = amountCents; else delete cur[src];
  await setJSON(key, cur);
  return cur;
}
async function spendForDays(dayList) {
  const docs = await Promise.all(dayList.map((d) => getJSON(`spend/${d}.json`)));
  let total = 0;
  const bySource = {};
  docs.forEach((doc) => {
    if (!doc) return;
    for (const [src, cents] of Object.entries(doc)) {
      total += cents;
      bySource[src] = (bySource[src] || 0) + cents;
    }
  });
  return { total, bySource };
}

// ---------- meta do mês ----------
async function getGoal() {
  const doc = await getJSON('config/goal.json');
  return doc && typeof doc.amount === 'number' ? doc.amount : 0;
}
async function setGoal(amountCents) {
  await setJSON('config/goal.json', { amount: Math.max(0, amountCents | 0) });
  return amountCents;
}

// ---------- agregação diária de eventos ----------
function emptyDayAgg(day) {
  return { day, views: {}, uniques: 0, mobile: 0, desktop: 0, pix: {}, pago: {}, revenue: 0, utm: {} };
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

// Dias fechados são agregados uma vez e cacheados; o dia atual é sempre ao vivo.
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

function kpisFrom(aggs, orders, spendTotal) {
  const paid = orders.filter((o) => o.status === 'paid');
  const gross = paid.reduce((a, o) => a + o.amount, 0);
  const net = paid.reduce((a, o) => a + (o.netAmount || o.amount), 0);
  const pixCount = orders.length;
  const spend = spendTotal || 0;
  return {
    gross,
    net,
    profit: net - spend,
    spend,
    roas: spend ? Math.round((gross / spend) * 100) / 100 : 0,
    cpa: paid.length ? Math.round(spend / paid.length) : 0,
    paidCount: paid.length,
    pixCount,
    ticket: paid.length ? Math.round(gross / paid.length) : 0,
    pixConversion: pixCount ? Math.round((paid.length / pixCount) * 100) : 0,
    visits: aggs.reduce((a, d) => a + (d.views.landing || 0), 0),
    uniques: aggs.reduce((a, d) => a + d.uniques, 0),
  };
}

// ---------- resumo completo ----------
async function summary(days) {
  const now = Date.now();
  const currDays = daysBack(days);
  const prevDays = daysBack(days, now - days * DAY_MS);
  const month = monthKey(now);

  const [currAggs, prevAggs, currOrders, prevOrdersAll, currSpend, prevSpend, goal, monthOrders] = await Promise.all([
    Promise.all(currDays.map(dayAgg)),
    Promise.all(prevDays.map(dayAgg)),
    listOrders(now - days * DAY_MS),
    listOrders(now - 2 * days * DAY_MS),
    spendForDays(currDays),
    spendForDays(prevDays),
    getGoal(),
    listOrders(monthStartTs(month)),
  ]);
  const prevOrders = prevOrdersAll.filter((o) => o.createdAt < now - days * DAY_MS);

  const v = (page) => currAggs.reduce((a, d) => a + (d.views[page] || 0), 0);
  const pixOf = (offer) => currAggs.reduce((a, d) => a + (d.pix[offer] || 0), 0);
  const pagoOf = (offer) => currAggs.reduce((a, d) => a + (d.pago[offer] || 0), 0);

  const funnel = [
    { step: 'Visitas na página de vendas', count: v('landing') },
    { step: 'Abriram o checkout', count: v('checkout') },
    { step: 'Geraram PIX', count: pixOf('checkout') },
    { step: 'Pagaram (venda principal)', count: pagoOf('checkout') },
    { step: 'Viram upsell', count: v('upsell_oferta') },
    { step: 'Pagaram upsell', count: pagoOf('upsell') },
    { step: 'Viram downsell', count: v('downsell_oferta') },
    { step: 'Pagaram downsell', count: pagoOf('downsell') },
  ];
  funnel.forEach((f, i) => {
    const base = i === 0 ? f.count : funnel[i - 1].count;
    f.rate = base ? Math.round((f.count / base) * 100) : 0;
  });

  // Vendas por produto + impacto de upsell/downsell
  const paidOrders = currOrders.filter((o) => o.status === 'paid');
  const products = {};
  const impact = { main: 0, upsell: 0, downsell: 0 };
  let payDeltaSum = 0, payDeltaCount = 0;
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)); // [weekday][hour] = vendas

  for (const o of paidOrders) {
    const key = `${o.offer}/${o.plan}`;
    products[key] = products[key] || { label: o.label, paid: 0, revenue: 0 };
    products[key].paid += 1;
    products[key].revenue += o.amount;

    if (o.offer === 'upsell') impact.upsell += o.amount;
    else if (o.offer === 'downsell') impact.downsell += o.amount;
    else impact.main += o.amount;

    if (o.paidAt && o.createdAt) { payDeltaSum += (o.paidAt - o.createdAt); payDeltaCount += 1; }
    const when = brtParts(o.paidAt || o.createdAt);
    heat[when.weekday][when.hour] += 1;
  }

  // Origens (UTM) com ROAS por origem
  const utm = {};
  for (const d of currAggs) {
    for (const [source, s] of Object.entries(d.utm)) {
      utm[source] = utm[source] || { views: 0, pago: 0, revenue: 0, campaign: s.campaign, spend: 0 };
      utm[source].views += s.views;
      utm[source].pago += s.pago;
      utm[source].revenue += s.revenue;
    }
  }
  for (const [src, cents] of Object.entries(currSpend.bySource)) {
    utm[src] = utm[src] || { views: 0, pago: 0, revenue: 0, campaign: '', spend: 0 };
    utm[src].spend += cents;
  }
  const utmArr = Object.entries(utm).map(([source, s]) => ({
    source, ...s,
    roas: s.spend ? Math.round((s.revenue / s.spend) * 100) / 100 : 0,
    profit: s.revenue - s.spend,
  })).sort((a, b) => (b.revenue - b.spend) - (a.revenue - a.spend) || b.views - a.views).slice(0, 25);

  // Meta do mês + projeção
  const monthPaid = monthOrders.filter((o) => o.status === 'paid');
  const monthRevenue = monthPaid.reduce((a, o) => a + o.amount, 0);
  const dim = daysInMonth(month);
  const elapsed = Math.max(1, parseInt(dayKey(now).slice(8, 10), 10));
  const projection = Math.round(monthRevenue / elapsed * dim);

  return {
    ok: true,
    generatedAt: now,
    days,
    storage: await storageKind(),
    storageDetail: storageError() || undefined,
    provider: getConfig().enabled ? 'assetpay' : 'stub',
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    kpis: kpisFrom(currAggs, currOrders, currSpend.total),
    prevKpis: kpisFrom(prevAggs, prevOrders, prevSpend.total),
    goal: { amount: goal, monthRevenue, projection, elapsed, daysInMonth: dim, month },
    impact,
    avgPayMinutes: payDeltaCount ? Math.round(payDeltaSum / payDeltaCount / 60000) : 0,
    heatmap: heat,
    daily: currAggs.map((d) => ({
      day: d.day, revenue: d.revenue, pago: sum(d.pago), pix: sum(d.pix),
      visits: d.views.landing || 0, uniques: d.uniques, mobile: d.mobile, desktop: d.desktop,
    })),
    funnel,
    products: Object.entries(products).map(([k, p]) => ({ key: k, ...p })).sort((a, b) => b.revenue - a.revenue),
    utm: utmArr,
  };
}

module.exports = {
  summary, aggregateDay, dayAgg, daysBack, kpisFrom,
  setSpend, spendForDays, getGoal, setGoal, monthKey, DAY_MS,
};
