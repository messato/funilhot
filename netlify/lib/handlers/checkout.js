'use strict';

const { resolveOfferLive, validateLead, formatBRL } = require('../catalog');
const { createPixCharge } = require('../provider');
const { rateLimit, clientIp } = require('../ratelimit');
const { saveOrder } = require('../orders');
const { setJSON, dayKey } = require('../store');
const { getSettings, findValidCoupon, applyCoupon, abVariant } = require('../settings');

const cleanUtm = (v) => (typeof v === 'string' ? v.slice(0, 80).replace(/[<>"']/g, '') : '');
const cleanRef = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) : '');

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
  const offer = await resolveOfferLive(payload.offer, payload.plan);
  if (!offer) {
    return reply(400, { ok: false, error: 'invalid_offer' });
  }

  const { errors, lead } = validateLead(payload);
  if (errors.length) {
    return reply(400, { ok: false, error: 'invalid_fields', fields: errors });
  }

  // Ajustes de preço (SEMPRE resolvidos no servidor): A/B, cupom e order bump.
  const settings = await getSettings();
  let amount = offer.amount;
  let abTag = '';
  const ab = settings.abTest;
  if (ab && ab.enabled && ab.plan === offer.plan && ab.priceB && payload.vid) {
    const variant = abVariant(String(payload.vid));
    abTag = variant;
    if (variant === 'B') amount = ab.priceB;
  }
  let discount = 0, couponCode = '';
  if (payload.coupon) {
    const coupon = findValidCoupon(settings, payload.coupon);
    if (!coupon) return reply(400, { ok: false, error: 'invalid_coupon' });
    const r = applyCoupon(amount, coupon);
    amount = r.amount; discount = r.discount; couponCode = coupon.code;
  }
  let bumpTaken = false;
  const bumpCfg = settings.orderBump;
  if (payload.orderBump && bumpCfg && bumpCfg.enabled) {
    bumpTaken = true; amount += bumpCfg.price;
  }
  const chargeLabel = offer.label + (bumpTaken ? ' + ' + bumpCfg.label : '');

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
      amount,
      webhookUrl,
      label: chargeLabel,
      customer: { name: lead.nome, email: lead.email, phone: lead.telefone, cpf: lead.cpf },
    });
    const qrImage = charge.qrImageBase64
      ? (charge.qrImageBase64.startsWith('data:') ? charge.qrImageBase64 : 'data:image/png;base64,' + charge.qrImageBase64)
      : '';

    // Registra o pedido e o evento de PIX gerado para o painel /admin.
    // Falha aqui não pode derrubar a venda — só loga.
    try {
      const now = Date.now();
      await saveOrder({
        id: charge.id,
        offer: offer.offer,
        plan: offer.plan,
        label: chargeLabel,
        amount,
        baseAmount: offer.amount,
        discount,
        couponCode,
        bumpTaken,
        abVariant: abTag,
        netAmount: charge.netAmount,
        status: charge.status === 'paid' ? 'paid' : 'pending',
        nome: lead.nome,
        email: lead.email,
        telefone: lead.telefone,
        cpf: lead.cpf, // guardado só p/ regenerar PIX; nunca exposto nas respostas do painel
        utmSource: cleanUtm(payload.us),
        utmMedium: cleanUtm(payload.um),
        utmCampaign: cleanUtm(payload.uc),
        ref: cleanRef(payload.ref),
        createdAt: now,
        paidAt: null,
      });
      await setJSON(`ev/${dayKey(now)}/${now}-${Math.random().toString(16).slice(2, 8)}.json`, {
        e: 'pix',
        offer: offer.offer,
        plan: offer.plan,
        amount,
        us: cleanUtm(payload.us),
        uc: cleanUtm(payload.uc),
        ts: now,
      });
    } catch (error) {
      console.error('order tracking failed:', error.message);
    }

    // Retornamos APENAS o que o front precisa — sem vazar a resposta crua do gateway.
    return reply(200, {
      ok: true,
      data: {
        id: charge.id,
        brcode: charge.brcode,
        qrImage,
        amount,
        price: formatBRL(amount),
        label: chargeLabel,
        discount,
        couponApplied: couponCode || undefined,
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
