'use strict';

const { setJSON, getJSON, listKeys, dayKey } = require('./store');
const { formatBRL } = require('./catalog');
const { isEnabled } = require('./features');
const { incrementCouponUse, getSettings } = require('./settings');

// Pedidos particionados por mês: orders/<yyyy-mm>/<txid>.json
function monthOf(ts = Date.now()) {
  return dayKey(ts).slice(0, 7);
}

function orderKey(month, id) {
  return `orders/${month}/${id}.json`;
}

async function saveOrder(order) {
  await setJSON(orderKey(monthOf(order.createdAt), order.id), order);
}

// Cobranças são pagas minutos após criadas — basta olhar o mês atual e o anterior.
async function findOrder(id) {
  const now = new Date();
  const months = [monthOf(), monthOf(now.setMonth(now.getMonth() - 1))];
  for (const month of months) {
    const order = await getJSON(orderKey(month, id));
    if (order) return { order, month };
  }
  return null;
}

async function listOrders(sinceTs) {
  const months = new Set();
  for (let ts = sinceTs; ts <= Date.now(); ts += 20 * 24 * 3600 * 1000) months.add(monthOf(ts));
  months.add(monthOf());

  const orders = [];
  for (const month of months) {
    const keys = await listKeys(`orders/${month}/`);
    const loaded = await Promise.all(keys.map((k) => getJSON(k)));
    for (const o of loaded) {
      if (o && o.createdAt >= sinceTs) orders.push(o);
    }
  }
  orders.sort((a, b) => b.createdAt - a.createdAt);
  return orders;
}

async function notifyTelegram(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  if (!(await isEnabled('telegram_venda'))) return;

  const text = [
    '💰 VENDA CONFIRMADA!',
    '',
    `📦 ${order.label}`,
    `💵 ${formatBRL(order.amount)}`,
    `👤 ${order.nome}`,
    `📧 ${order.email}`,
    order.utmSource ? `📣 Origem: ${order.utmSource}${order.utmCampaign ? ' / ' + order.utmCampaign : ''}` : '',
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('telegram notify failed:', error.message);
  }
}

// Dispara os webhooks de saída configurados (Zapier/n8n/Discord/etc.).
async function fireWebhooks(order) {
  try {
    if (!(await isEnabled('webhooks'))) return;
    const s = await getSettings();
    const hooks = (s.webhooks || []).filter((w) => w.active && w.url);
    if (!hooks.length) return;
    const payload = {
      event: 'sale.paid', id: order.id, label: order.label, amount: order.amount,
      plan: order.plan, offer: order.offer, nome: order.nome, email: order.email,
      utmSource: order.utmSource || '', ref: order.ref || '', paidAt: order.paidAt,
    };
    await Promise.all(hooks.map((w) => fetch(w.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }).catch((e) => console.error('webhook failed:', w.url, e.message))));
  } catch (error) {
    console.error('fireWebhooks error:', error.message);
  }
}

// Idempotente: marca pago uma única vez, grava o evento e notifica.
async function markPaid(id) {
  const found = await findOrder(id);
  if (!found || found.order.status === 'paid') return found ? found.order : null;

  const order = { ...found.order, status: 'paid', paidAt: Date.now() };
  await setJSON(orderKey(found.month, id), order);

  if (order.couponCode) {
    try { await incrementCouponUse(order.couponCode); } catch { /* não bloqueia a venda */ }
  }

  const ts = Date.now();
  await setJSON(`ev/${dayKey(ts)}/${ts}-${Math.random().toString(16).slice(2, 8)}.json`, {
    e: 'pago',
    offer: order.offer,
    plan: order.plan,
    amount: order.amount,
    us: order.utmSource || '',
    uc: order.utmCampaign || '',
    ts,
  });

  await notifyTelegram(order);
  await fireWebhooks(order);

  // Entrega do acesso pelo bot. Em try/catch como o resto do fluxo: problema
  // no Telegram não pode invalidar uma venda já confirmada.
  try {
    const botAccess = require('./bot/access');
    await botAccess.aoPagarPedido(order);
  } catch (error) {
    console.error('entrega pelo bot falhou:', error && error.message);
  }

  return order;
}

module.exports = { saveOrder, findOrder, listOrders, markPaid, monthOf };
