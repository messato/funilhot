'use strict';

const { setJSON, getJSON, listKeys, dayKey } = require('./store');
const { formatBRL } = require('./catalog');
const { isEnabled } = require('./features');

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

// Idempotente: marca pago uma única vez, grava o evento e notifica.
async function markPaid(id) {
  const found = await findOrder(id);
  if (!found || found.order.status === 'paid') return found ? found.order : null;

  const order = { ...found.order, status: 'paid', paidAt: Date.now() };
  await setJSON(orderKey(found.month, id), order);

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
  return order;
}

module.exports = { saveOrder, findOrder, listOrders, markPaid, monthOf };
