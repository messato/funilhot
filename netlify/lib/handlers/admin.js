'use strict';

const { makeToken, verifyToken, passwordMatches, headerKey, TOKEN_TTL_MS } = require('../adminauth');
const { dayKey, setJSON, listKeys, getJSON } = require('../store');
const { listOrders, findOrder, saveOrder } = require('../orders');
const { createPixCharge } = require('../provider');
const { formatBRL } = require('../catalog');
const { rateLimit, clientIp } = require('../ratelimit');
const { summary, setSpend, setGoal, DAY_MS } = require('../metrics');
const { FEATURES, getFlags, setFlag } = require('../features');
const { getSettings, saveSettings } = require('../settings');
const { computeMembers, ufFromPhone } = require('../members');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, payload, headers = JSON_HEADERS) => ({
  statusCode,
  headers,
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

// Nunca expõe o CPF nas respostas do painel (fica guardado só p/ regenerar PIX).
function stripOrder(o) {
  const { cpf, ...rest } = o;
  return { ...rest, price: formatBRL(o.amount) };
}

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
      return reply(200, { ok: true, orders: filtered.slice(0, 500).map(stripOrder) });
    }

    if (route === 'settings') {
      if (event.httpMethod === 'POST') {
        let body = {};
        try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
        return reply(200, { ok: true, settings: await saveSettings(body) });
      }
      return reply(200, { ok: true, settings: await getSettings() });
    }

    if (route === 'members') {
      const windowDays = Math.min(730, Math.max(30, parseInt(q.window, 10) || 400));
      return reply(200, { ok: true, ...(await computeMembers(windowDays)) });
    }

    if (route === 'affiliates') {
      const windowDays = Math.min(730, Math.max(1, parseInt(q.window, 10) || 90));
      const orders = await listOrders(Date.now() - windowDays * DAY_MS);
      const paid = orders.filter((o) => o.status === 'paid' && o.ref);
      const settings = await getSettings();
      const affMap = {};
      (settings.affiliates || []).forEach((a) => { affMap[a.code] = { code: a.code, name: a.name, commissionPct: a.commissionPct, sales: 0, revenue: 0, commission: 0, registered: true }; });
      paid.forEach((o) => {
        if (!affMap[o.ref]) affMap[o.ref] = { code: o.ref, name: '(não cadastrado)', commissionPct: 0, sales: 0, revenue: 0, commission: 0, registered: false };
        affMap[o.ref].sales += 1;
        affMap[o.ref].revenue += o.amount;
      });
      const affiliates = Object.keys(affMap).map((k) => affMap[k]);
      affiliates.forEach((a) => { a.commission = Math.round(a.revenue * (a.commissionPct || 0) / 100); });
      affiliates.sort((x, y) => y.revenue - x.revenue);
      const totals = affiliates.reduce((t, a) => ({ revenue: t.revenue + a.revenue, commission: t.commission + a.commission, sales: t.sales + a.sales }), { revenue: 0, commission: 0, sales: 0 });
      return reply(200, { ok: true, affiliates, totals, windowDays });
    }

    if (route === 'abandoned') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      const settings = await getSettings();
      const cutoff = Date.now() - settings.abandonMinutes * 60 * 1000;
      const abandoned = orders.filter((o) => o.status !== 'paid' && o.createdAt < cutoff);
      return reply(200, { ok: true, abandoned: abandoned.slice(0, 500).map(stripOrder) });
    }

    if (route === 'export.csv') {
      const orders = await listOrders(Date.now() - days * DAY_MS);
      return reply(200, toCSV(orders), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pedidos-${dayKey()}.csv"`,
      });
    }

    // Público personalizado do Meta: lista de compradores (formato customer list).
    if (route === 'audience.csv') {
      const { members } = await computeMembers(730);
      const header = ['email', 'phone', 'fn', 'ln', 'st', 'country'];
      const rows = members.map((m) => {
        const parts = String(m.name || '').trim().split(/\s+/);
        const fn = (parts.shift() || '').toLowerCase();
        const ln = parts.join(' ').toLowerCase();
        const digits = String(m.telefone || '').replace(/\D/g, '');
        // Dígitos com código do país (sem '+', pra não disparar o anti-fórmula do CSV). O Meta normaliza.
        const phone = digits ? (digits.startsWith('55') ? digits : '55' + digits) : '';
        return [
          String(m.email || '').toLowerCase(),
          phone, fn, ln, ufFromPhone(m.telefone).toLowerCase(), 'br',
        ].map(csvEscape).join(',');
      });
      return reply(200, [header.join(','), ...rows].join('\r\n'), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="publico-meta-${dayKey()}.csv"`,
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

    // Regenerar PIX de um pedido pendente/expirado (mesmo valor, novo QR).
    if (route === 'regen-pix' && event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { /* */ }
      const found = await findOrder(String(body.id || ''));
      if (!found) return reply(404, { ok: false, error: 'nao_encontrado' });
      const o = found.order;
      if (o.status === 'paid') return reply(400, { ok: false, error: 'ja_pago' });
      if (!o.cpf) return reply(400, { ok: false, error: 'sem_cpf' }); // pedidos antigos não têm CPF guardado

      const h = event.headers || {};
      const secret = process.env.WEBHOOK_SECRET || '';
      let webhookUrl;
      if (h.host) {
        webhookUrl = `${h['x-forwarded-proto'] || 'https'}://${h.host}/api/webhook`;
        if (secret) webhookUrl += `?token=${encodeURIComponent(secret)}`;
      }
      const charge = await createPixCharge({
        amount: o.amount, webhookUrl, label: o.label,
        customer: { name: o.nome, email: o.email, phone: o.telefone, cpf: o.cpf },
      });
      const qrImage = charge.qrImageBase64
        ? (charge.qrImageBase64.startsWith('data:') ? charge.qrImageBase64 : 'data:image/png;base64,' + charge.qrImageBase64)
        : '';
      const now = Date.now();
      await saveOrder({ ...o, id: charge.id, netAmount: charge.netAmount, status: 'pending', createdAt: now, paidAt: null, regenOf: o.id });
      await setJSON(`ev/${dayKey(now)}/${now}-${Math.random().toString(16).slice(2, 8)}.json`, {
        e: 'pix', offer: o.offer, plan: o.plan, amount: o.amount, us: o.utmSource || '', uc: o.utmCampaign || '', ts: now,
      });
      return reply(200, { ok: true, data: { id: charge.id, brcode: charge.brcode, qrImage, price: formatBRL(o.amount) } });
    }

    // Backup total (JSON com tudo do KV, menos binários de mídia). Token-protegido.
    if (route === 'backup') {
      const prefixes = ['config/', 'orders/', 'ev/', 'spend/', 'rollup/', 'social/'];
      const data = {};
      for (const p of prefixes) {
        const keys = await listKeys(p);
        for (const k of keys) data[k] = await getJSON(k);
      }
      return reply(200, JSON.stringify({ exportedAt: Date.now(), data }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="backup-funilhot-${dayKey()}.json"`,
      });
    }

    // Testar um webhook de saída (dispara payload de exemplo server-side).
    if (route === 'webhook-test' && event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { /* */ }
      const url = String(body.url || '');
      if (!/^https:\/\//i.test(url)) return reply(400, { ok: false, error: 'url_invalida' });
      try {
        const r = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'test', from: 'funilhot', at: Date.now(), sample: { label: 'Plano Mensal', amount: 3990 } }),
        });
        return reply(200, { ok: true, status: r.status });
      } catch (e) {
        return reply(200, { ok: false, error: 'falha_ao_enviar' });
      }
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
