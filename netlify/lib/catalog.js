'use strict';

// Catálogo AUTORITATIVO do servidor. Preços SEMPRE em CENTAVOS.
// O cliente nunca define o valor — ele só escolhe (offer, plan) e o
// servidor resolve o preço aqui. Isso elimina o price tampering.
const CATALOG = {
  checkout: {
    mensal: { label: 'Plano Mensal', amount: 3990 },
    trimestral: { label: 'Plano Trimestral', amount: 9790 },
    anual: { label: 'Plano Anual', amount: 29700 },
  },
  upsell: {
    mensal: { label: 'Upgrade Mensal', amount: 4990 },
    trimestral: { label: 'Upgrade Trimestral', amount: 14990 },
  },
  downsell: {
    mensal: { label: 'Oferta Final Mensal', amount: 3990 },
    trimestral: { label: 'Oferta Final Trimestral', amount: 11990 },
  },
};

function resolveOffer(offer, plan) {
  const group = CATALOG[offer];
  if (!group) return null;
  const item = group[plan];
  if (!item) return null;
  return { offer, plan, label: item.label, amount: item.amount };
}

// Versão que aplica os preços editados no painel (config/settings.json).
async function resolveOfferLive(offer, plan) {
  const base = resolveOffer(offer, plan);
  if (!base) return null;
  try {
    const { getSettings } = require('./settings');
    const s = await getSettings();
    const p = s.prices && s.prices[`${offer}/${plan}`];
    if (typeof p === 'number' && p > 0) base.amount = p;
  } catch { /* mantém o preço padrão se as settings falharem */ }
  return base;
}

function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// AssetPay exige phone e document (CPF) para criar a transação.
function validateLead(payload) {
  const errors = [];
  const nome = typeof payload.nome === 'string' ? payload.nome.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const telefone = (typeof payload.telefone === 'string' ? payload.telefone : '').replace(/\D/g, '');
  const cpf = (typeof payload.cpf === 'string' ? payload.cpf : '').replace(/\D/g, '');

  if (nome.length < 2 || nome.length > 120) errors.push('nome');
  if (!EMAIL_RE.test(email) || email.length > 160) errors.push('email');
  if (telefone.length < 10 || telefone.length > 13) errors.push('telefone');
  if (cpf.length !== 11) errors.push('cpf');

  return { errors, lead: { nome: nome.slice(0, 120), email: email.slice(0, 160), telefone, cpf } };
}

module.exports = { CATALOG, resolveOffer, resolveOfferLive, formatBRL, validateLead };
