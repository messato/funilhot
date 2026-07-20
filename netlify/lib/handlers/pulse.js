'use strict';

// Endpoint PÚBLICO de prova social para a landing. Retorna contagens reais de
// compras recentes e uma lista ANONIMIZADA (só estado + tempo), sem nomes nem
// contato. Respeita o toggle prova_social e tem rate limit próprio.

const { listOrders } = require('../orders');
const { ufFromPhone } = require('../members');
const { isEnabled } = require('../features');
const { rateLimit, clientIp } = require('../ratelimit');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' };
const reply = (s, o) => ({ statusCode: s, headers: JSON_HEADERS, body: JSON.stringify(o) });
const HOUR = 3600 * 1000;

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return reply(405, { ok: false });
  if (!rateLimit('pulse:' + clientIp(event), { limit: 120, windowMs: 60000 }).ok) {
    return reply(429, { ok: false });
  }
  if (!(await isEnabled('prova_social'))) return reply(200, { ok: true, enabled: false });

  const now = Date.now();
  const orders = await listOrders(now - 24 * HOUR);
  const paid = orders.filter((o) => o.status === 'paid' && o.paidAt && o.paidAt >= now - 24 * HOUR);

  const lastHour = paid.filter((o) => o.paidAt >= now - HOUR).length;
  const recent = paid
    .sort((a, b) => b.paidAt - a.paidAt)
    .slice(0, 8)
    .map((o) => ({ uf: ufFromPhone(o.telefone) || 'BR', minAgo: Math.max(1, Math.round((now - o.paidAt) / 60000)) }));

  return reply(200, { ok: true, enabled: true, today: paid.length, lastHour, recent });
};
