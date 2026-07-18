'use strict';

const { makeToken, verifyToken, passwordMatches, headerKey, TOKEN_TTL_MS } = require('../adminauth');
const { dayKey } = require('../store');
const { listOrders } = require('../orders');
const { formatBRL } = require('../catalog');
const { rateLimit, clientIp } = require('../ratelimit');
const { summary, setSpend, setGoal, DAY_MS } = require('../metrics');
const { FEATURES, getFlags, setFlag } = require('../features');
const { getSettings, saveSettings } = require('../settings');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, payload, headers = JSON_HEADERS) => ({
  statusCode,
  headers,
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

function csvEscape(value) {
  let s = String(value == null ? '' : value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
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
  if (!process.env.ADMIN_PASSWORD) {
    return reply(503, { ok: false, error: 'admin_not_configured' });
  }

  const match = (event.path || '').match(/\/admin\/?([^/?]*)/);
  const route = match ? match[1] : '';
  const q = event.queryStringParameters || {};
  const ip = clientIp(event);

  // Login: valida a senha e devolve um token temporário. Lockout mais agressivo.
  if (route === 'login') {
    if (!rateLimit('login:' + ip, { limit: 8, windowMs: 15 * 60 * 1000 }).ok) {
      return reply(429, { ok: false, error: 'muitas_tentativas' });
    }
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
    if (!passwordMatches(body.password)) {
      return reply(401, { ok: false, error: 'senha_incorreta' });
    }
    return reply(200, { ok: true, token: makeToken(), expiresIn: TOKEN_TTL_MS });
  }

  if (!rateLimit('admin:' + ip, { limit: 180, windowMs: 60000 }).ok) {
    return reply(429, { ok: false, error: 'rate_limited' });
  }
  if (!verifyToken(headerKey(event))) {
    return reply(401, { ok: false, error: 'unauthorized' });
  }

  const days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 30));

  try {
    if (route === 'ping') return reply(200, { ok: true });

    if (route === 'summary') return reply(200, await summary(days));

    if (route === 'orders') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      const search = (q.q || '').toLowerCase().trim();
      let filtered = q.status ? orders.filter((o) => o.status === q.status) : orders;
      if (search) {
        filtered = filtered.filter((o) =>
          (o.nome || '').toLowerCase().includes(search) ||
          (o.email || '').toLowerCase().includes(search) ||
          (o.id || '').toLowerCase().includes(search));
      }
      return reply(200, { ok: true, orders: filtered.slice(0, 500).map((o) => ({ ...o, price: formatBRL(o.amount) })) });
    }

    if (route === 'settings') {
      if (event.httpMethod === 'POST') {
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
        return reply(200, { ok: true, settings: await saveSettings(body) });
      }
      return reply(200, { ok: true, settings: await getSettings() });
    }

    if (route === 'abandoned') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      const settings = await getSettings();
      const cutoff = Date.now() - settings.abandonMinutes * 60 * 1000;
      const abandoned = orders.filter((o) => o.status !== 'paid' && o.createdAt < cutoff);
      return reply(200, { ok: true, abandoned: abandoned.slice(0, 500).map((o) => ({ ...o, price: formatBRL(o.amount) })) });
    }

    if (route === 'export.csv') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      return reply(200, toCSV(orders), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pedidos-${dayKey()}.csv"`,
      });
    }

    // Lançar gasto de tráfego (ROAS)
    if (route === 'spend' && event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
      const day = /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : dayKey();
      const source = (body.source || '(geral)').toString().slice(0, 60);
      const amount = Math.max(0, Math.round(Number(body.amount) * 100) || 0); // reais -> centavos
      await setSpend(day, source, amount);
      return reply(200, { ok: true });
    }

    // Recursos ligar/desligar
    if (route === 'features') {
      if (event.httpMethod === 'POST') {
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
        const ok = await setFlag(body.id, !!body.on);
        return reply(ok ? 200 : 400, { ok, error: ok ? undefined : 'nao_ativavel' });
      }
      return reply(200, { ok: true, features: FEATURES, flags: await getFlags() });
    }

    // Definir meta do mês
    if (route === 'goal' && event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
      await setGoal(Math.round(Number(body.amount) * 100) || 0); // reais -> centavos
      return reply(200, { ok: true });
    }

    return reply(404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('admin error:', error.message);
    return reply(500, { ok: false, error: 'internal' });
  }
};
