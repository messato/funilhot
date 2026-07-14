'use strict';

// Adapter do gateway AssetPay — https://api.assetpay.com.br/api/v1
// Doc: https://assetpay.apidog.io/
//
// Variáveis de ambiente (configure no painel do Netlify, NUNCA no código):
//   ASSETPAY_SECRET_KEY -> sk_live_...  (obrigatório)
//   ASSETPAY_PUBLIC_KEY -> pk_live_...  (obrigatório)
//   ASSETPAY_API_URL    -> base da API (opcional — default abaixo)
//
// Autenticação: Basic base64(secret_key:public_key).
// Sem as chaves, roda em modo STUB (PIX simulado que aprova sozinho) para dev.

function getConfig() {
  const secret = process.env.ASSETPAY_SECRET_KEY || '';
  const publicKey = process.env.ASSETPAY_PUBLIC_KEY || '';
  const base = (process.env.ASSETPAY_API_URL || 'https://api.assetpay.com.br/api/v1').replace(/\/+$/, '');
  return { secret, publicKey, base, enabled: Boolean(secret && publicKey) };
}

function authHeader(secret, publicKey) {
  return 'Basic ' + Buffer.from(`${secret}:${publicKey}`).toString('base64');
}

// Normaliza os status da AssetPay (paid, processing, refused, ...) para 3 estados internos.
function normalizeStatus(raw) {
  const v = String(raw || '').toLowerCase();
  if (['paid', 'approved', 'completed', 'concluida', 'pago', 'success'].includes(v)) return 'paid';
  if (['refused', 'canceled', 'cancelled', 'expired', 'failed', 'error', 'chargeback', 'refunded'].includes(v)) return 'expired';
  return 'pending';
}

// Baixa a imagem do QR e devolve como data URI (para respeitar a CSP img-src 'self' data:).
async function fetchQrAsDataUri(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const contentType = res.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 200000) return '';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

// Cria uma cobrança PIX. `amount` em CENTAVOS (definido pelo servidor, nunca pelo cliente).
async function createPixCharge({ amount, webhookUrl, customer, label, externalRef }) {
  const { secret, publicKey, base, enabled } = getConfig();

  if (!enabled) {
    const id = 'stub-' + Math.random().toString(16).slice(2, 12);
    return {
      id,
      brcode: '00020126BR.GOV.BCB.PIX-SIMULADO-' + id + '5204000053039865406' + (amount / 100).toFixed(2) + '5802BR6304STUB',
      qrImageBase64: '',
      status: 'pending',
      provider: 'stub',
    };
  }

  const body = {
    amount,
    paymentMethod: 'PIX',
    items: [{ title: label || 'Acesso VIP', unitPrice: amount, quantity: 1 }],
  };
  if (customer) {
    // phone e document (CPF) são obrigatórios na AssetPay
    body.customer = {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      document: { type: 'CPF', number: customer.cpf },
    };
  }
  if (webhookUrl) body.postbackUrl = webhookUrl;
  if (externalRef) body.externalRef = externalRef;

  const res = await fetch(base + '/transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authHeader(secret, publicKey),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error('provider_create_failed');
    err.status = res.status;
    err.detail = text.slice(0, 500);
    throw err;
  }

  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }

  const pix = data.pix || {};
  const brcode = pix.qrcode || pix.emv || pix.copyPaste || '';
  // A AssetPay retorna qrcodeUrl null; nesse caso geramos a imagem do QR
  // a partir do copia-e-cola e embutimos como data: (compatível com a CSP).
  let qrImageBase64 = pix.qrcodeUrl ? await fetchQrAsDataUri(pix.qrcodeUrl) : '';
  if (!qrImageBase64 && brcode) {
    qrImageBase64 = await fetchQrAsDataUri(
      'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(brcode)
    );
  }

  return {
    id: String(data.id || ''),
    brcode,
    qrImageBase64,
    status: normalizeStatus(data.status),
    provider: 'assetpay',
  };
}

// Consulta o status da cobrança direto no gateway (fonte da verdade para liberar acesso).
async function getStatus(id) {
  const { secret, publicKey, base, enabled } = getConfig();

  if (!enabled || String(id).startsWith('stub-')) {
    return { id, status: 'paid', provider: 'stub' };
  }

  const res = await fetch(base + '/transactions/' + encodeURIComponent(id), {
    headers: { Accept: 'application/json', Authorization: authHeader(secret, publicKey) },
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error('provider_status_failed');
    err.status = res.status;
    throw err;
  }

  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }

  return { id: String(data.id || id), status: normalizeStatus(data.status), provider: 'assetpay' };
}

module.exports = { createPixCharge, getStatus, normalizeStatus, getConfig };
