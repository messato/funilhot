'use strict';

// Deriva a base de "membros" a partir dos pedidos pagos. Um membro é um cliente
// (agrupado por e-mail; telefone como fallback). O acesso vence em
// paidAt + duração do plano. Alimenta as abas Membros, MRR/renovação,
// gamificação e coorte de retenção do painel.

const { listOrders } = require('./orders');
const { dayKey } = require('./store');

const DAY = 24 * 3600 * 1000;
const PLAN_DAYS = { mensal: 30, trimestral: 90, anual: 365 };
// Valor mensal equivalente (para MRR): trimestral vale 1/3, anual 1/12.
const MONTHLY_EQUIV = { mensal: 1, trimestral: 1 / 3, anual: 1 / 12 };

const DDD_UF = { 11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP', 21: 'RJ', 22: 'RJ', 24: 'RJ', 27: 'ES', 28: 'ES', 31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG', 41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR', 47: 'SC', 48: 'SC', 49: 'SC', 51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS', 61: 'DF', 62: 'GO', 63: 'TO', 64: 'GO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO', 71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE', 81: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 86: 'PI', 87: 'PE', 88: 'CE', 89: 'PI', 91: 'PA', 92: 'AM', 93: 'PA', 94: 'PA', 95: 'RR', 96: 'AP', 97: 'AM', 98: 'MA', 99: 'MA' };
function ufFromPhone(p) {
  p = String(p || '').replace(/\D/g, '');
  if (p.length >= 12 && p.slice(0, 2) === '55') p = p.slice(2);
  if (p.length < 10) return '';
  return DDD_UF[+p.slice(0, 2)] || '';
}
function planDays(plan) { return PLAN_DAYS[plan] || 30; }
function monthOf(ts) { return dayKey(ts).slice(0, 7); }
function custKey(o) { return (o.email || '').toLowerCase().trim() || String(o.telefone || '').replace(/\D/g, '') || o.id; }

async function computeMembers(windowDays = 400) {
  const since = Date.now() - windowDays * DAY;
  const orders = await listOrders(since);
  const paid = orders.filter((o) => o.status === 'paid' && o.paidAt);

  const byCust = {};
  for (const o of paid) {
    const k = custKey(o);
    (byCust[k] = byCust[k] || []).push(o);
  }

  const now = Date.now();
  const members = Object.keys(byCust).map((k) => {
    const list = byCust[k].sort((a, b) => a.paidAt - b.paidAt);
    const first = list[0], last = list[list.length - 1];
    const expiresAt = last.paidAt + planDays(last.plan) * DAY;
    const active = expiresAt >= now;
    const daysLeft = Math.round((expiresAt - now) / DAY);
    const totalSpent = list.reduce((a, o) => a + o.amount, 0);
    const monthlyValue = Math.round(last.amount * (MONTHLY_EQUIV[last.plan] || 1));
    const tenureMonths = Math.max(0, Math.round((now - first.paidAt) / (30 * DAY)));
    return {
      key: k,
      name: first.nome || '(sem nome)',
      email: first.email || '',
      telefone: first.telefone || '',
      plan: last.plan,
      offer: last.offer,
      label: last.label,
      startAt: first.paidAt,
      lastAt: last.paidAt,
      expiresAt,
      active,
      daysLeft,
      purchases: list.length,
      totalSpent,
      monthlyValue,
      tenureMonths,
      cohort: monthOf(first.paidAt),
    };
  }).sort((a, b) => b.lastAt - a.lastAt);

  // Estatísticas de renovação / MRR
  const activeMembers = members.filter((m) => m.active);
  const mrr = activeMembers.reduce((a, m) => a + m.monthlyValue, 0);
  const expiring7 = activeMembers.filter((m) => m.daysLeft <= 7).length;
  const arpu = activeMembers.length ? Math.round(mrr / activeMembers.length) : 0;
  const stats = {
    total: members.length,
    active: activeMembers.length,
    expired: members.length - activeMembers.length,
    expiring7,
    mrr,
    arr: mrr * 12,
    arpu,
    repeat: members.filter((m) => m.purchases > 1).length,
  };

  // Coorte de retenção: por mês da 1ª compra, quantos entraram e quantos seguem ativos.
  const cohortMap = {};
  members.forEach((m) => {
    const c = cohortMap[m.cohort] = cohortMap[m.cohort] || { cohort: m.cohort, size: 0, retained: 0, revenue: 0 };
    c.size += 1;
    if (m.active) c.retained += 1;
    c.revenue += m.totalSpent;
  });
  const cohort = Object.values(cohortMap)
    .map((c) => ({ ...c, retentionPct: c.size ? Math.round(c.retained / c.size * 100) : 0 }))
    .sort((a, b) => (a.cohort < b.cohort ? 1 : -1))
    .slice(0, 12);

  return { members, stats, cohort, generatedAt: now };
}

// custKey é exportado para o bot indexar assinaturas pelo MESMO critério de
// identidade do painel (e-mail, com telefone de reserva). Duplicar essa regra
// faria a renovação de um mesmo cliente virar dois cadastros.
module.exports = { computeMembers, planDays, PLAN_DAYS, ufFromPhone, custKey };
