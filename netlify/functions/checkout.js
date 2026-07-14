'use strict';

const { resolveOffer, validateLead, formatBRL } = require('../lib/catalog');
const { createPixCharge } = require('../lib/provider');
const { rateLimit, clientIp } = require('../lib/ratelimit');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reply(statusCode, payload) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, error: 'method_not_allowed' });
  }
  if ((event.body || '').length > 4000) {
    return reply(413, { ok: false, error: 'payload_too_large' });
  }
  if (!rateLimit('checkout:' + clientIp(event)).ok) {
    return reply(429, { ok: false, error: 'rate_limited' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { ok: false, error: 'invalid_json' });
  }

  // Preço é resolvido no servidor a partir de (offer, plan). O valor enviado
  // pelo cliente é ignorado de propósito.
  const offer = resolveOffer(payload.offer, payload.plan);
  if (!offer) {
    return reply(400, { ok: false, error: 'invalid_offer' });
  }

  const { errors, lead } = validateLead(payload);
  if (errors.length) {
    return reply(400, { ok: false, error: 'invalid_fields', fields: errors });
  }

  const headers = event.headers || {};
  const proto = headers['x-forwarded-proto'] || 'https';
  const host = headers['host'];
  const secret = process.env.WEBHOOK_SECRET || '';
  let webhookUrl;
  if (host) {
    webhookUrl = `${proto}://${host}/api/webhook`;
    if (secret) webhookUrl += `?token=${encodeURIComponent(secret)}`;
  }

  try {
    const charge = await createPixCharge({
      amount: offer.amount,
      webhookUrl,
      label: offer.label,
      customer: { name: lead.nome, email: lead.email, phone: lead.telefone, cpf: lead.cpf },
    });
    const qrImage = charge.qrImageBase64
      ? (charge.qrImageBase64.startsWith('data:') ? charge.qrImageBase64 : 'data:image/png;base64,' + charge.qrImageBase64)
      : '';

    // Retornamos APENAS o que o front precisa — sem vazar a resposta crua do gateway.
    return reply(200, {
      ok: true,
      data: {
        id: charge.id,
        brcode: charge.brcode,
        qrImage,
        amount: offer.amount,
        price: formatBRL(offer.amount),
        label: offer.label,
        status: charge.status,
        provider: charge.provider,
      },
    });
  } catch (error) {
    // Não expomos detalhes internos do provedor ao cliente.
    console.error('checkout provider error:', error && error.message, error && error.detail);
    return reply(502, { ok: false, error: 'provider_error' });
  }
};
