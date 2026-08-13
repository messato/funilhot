'use strict';

const { getStatus } = require('../provider');
const { rateLimit, clientIp } = require('../ratelimit');
const { markPaid } = require('../orders');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reply(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

// Verifica no gateway se a cobrança foi realmente paga.
// É esta rota (não o redirect do navegador) que autoriza a entrega.
exports.handler = async function (event) {
  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id || id.length > 80 || !/^[\w-]+$/.test(id)) {
    return reply(400, { ok: false, error: 'invalid_id' });
  }
  if (!rateLimit('status:' + clientIp(event), { limit: 60, windowMs: 60000 }).ok) {
    return reply(429, { ok: false, error: 'rate_limited' });
  }

  try {
    const s = await getStatus(id);
    const pago = s.status === 'paid';
    let claim = '';
    if (pago) {
      // Mesmo sem webhook configurado, o polling do comprador marca a venda como paga.
      try { await markPaid(id); } catch (error) { console.error('markPaid failed:', error.message); }
      // Código de resgate para o botão "receber no Telegram" — só é revelado
      // depois que o gateway confirmou o pagamento.
      try {
        const { getOrderLink } = require('../bot/state');
        const vinculo = await getOrderLink(id);
        if (vinculo && vinculo.claim && !vinculo.deliveredAt) claim = vinculo.claim;
      } catch (error) { console.error('claim lookup failed:', error && error.message); }
    }
    return reply(200, { ok: true, status: s.status, paid: pago, claim });
  } catch (error) {
    console.error('status provider error:', error && error.message);
    return reply(502, { ok: false, error: 'provider_error' });
  }
};
