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

function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLead(payload) {
  const errors = [];
  const nome = typeof payload.nome === 'string' ? payload.nome.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const telefone = typeof payload.telefone === 'string' ? payload.telefone.trim() : '';

  if (nome.length < 2 || nome.length > 120) errors.push('nome');
  if (!EMAIL_RE.test(email) || email.length > 160) errors.push('email');
  if (telefone.length > 40) errors.push('telefone');

  return { errors, lead: { nome: nome.slice(0, 120), email: email.slice(0, 160), telefone: telefone.slice(0, 40) } };
}

module.exports = { CATALOG, resolveOffer, formatBRL, validateLead };
