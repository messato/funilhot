import { getStore } from '@netlify/blobs';
import store from '../lib/store.js';
import metrics from '../lib/metrics.js';
import catalog from '../lib/catalog.js';

store.useGetStore(getStore);

// Roda às 00:00 UTC = 21:00 no horário de Brasília.
export const config = { schedule: '0 0 * * *' };

export default async function () {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return new Response('telegram não configurado', { status: 200 });
  }

  const s = await metrics.summary(1);
  const k = s.kpis;
  const brl = catalog.formatBRL;

  const topUtm = (s.utm || []).slice().sort((a, b) => b.revenue - a.revenue)[0];

  const text = [
    '📊 RESUMO DO DIA',
    '',
    `💰 Faturamento: ${brl(k.gross)}`,
    `💵 Líquido: ${brl(k.net)}`,
    `🛒 Vendas: ${k.paidCount}`,
    `🎯 Ticket médio: ${brl(k.ticket)}`,
    `📈 PIX gerados: ${k.pixCount} · conversão ${k.pixConversion}%`,
    `👀 Visitas: ${k.visits} · únicos: ${k.uniques}`,
    k.spend ? `📣 Gasto: ${brl(k.spend)} · ROAS ${k.roas} · lucro ${brl(k.profit)}` : '',
    topUtm && topUtm.revenue ? `🏆 Melhor origem: ${topUtm.source} (${brl(topUtm.revenue)})` : '',
    '',
    `Meta do mês: ${brl(s.goal.monthRevenue)} de ${brl(s.goal.amount)} · projeção ${brl(s.goal.projection)}`,
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('daily summary failed:', error.message);
  }

  return new Response('ok', { status: 200 });
}
