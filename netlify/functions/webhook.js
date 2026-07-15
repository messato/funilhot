'use strict';

const { markPaid } = require('../lib/orders');
const { normalizeStatus } = require('../lib/provider');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

// Recebe as confirmações de pagamento do gateway.
// Como não há banco de dados aqui, apenas validamos e respondemos 200 rápido
// (a fonte da verdade para liberar acesso é /api/status, que consulta o gateway).
// Ao adicionar persistência no futuro, marque o pedido como pago aqui.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ ok: false }) };
  }

  const secret = process.env.WEBHOOK_SECRET || '';
  if (secret) {
    const token = (event.queryStringParameters && event.queryStringParameters.token) || '';
    if (token !== secret) {
      return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ ok: false }) };
    }
  }

  try {
    // AssetPay envia { event, transaction: { id, status } }
    const body = JSON.parse(event.body || '{}');
    const tx = body.transaction || body;
    console.log('assetpay webhook:', body.event, tx && tx.id, tx && tx.status);
    if (tx && tx.id && normalizeStatus(tx.status) === 'paid') {
      await markPaid(String(tx.id));
    }
  } catch (error) {
    // corpo inválido é ignorado — só confirmamos o recebimento
    console.error('webhook processing failed:', error.message);
  }

  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};
