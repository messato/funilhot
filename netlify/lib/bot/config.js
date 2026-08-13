'use strict';

// Ponto único que decide QUAL bot está no ar.
// Todo o resto do código pede o token daqui — é isso que faz a virada para o
// bot reserva ser uma troca de configuração, e não uma alteração de código.

const { getJSON, setJSON } = require('../store');

const CHAVE_ATIVO = 'bot/active.json';

function tokenPrincipal() { return process.env.TELEGRAM_PREVIEW_BOT_TOKEN || ''; }
function tokenReserva() { return process.env.TELEGRAM_BACKUP_BOT_TOKEN || ''; }

/** Qual bot está ativo: 'principal' (padrão) ou 'reserva'. */
async function papelAtivo() {
  const doc = await getJSON(CHAVE_ATIVO);
  return doc && doc.papel === 'reserva' ? 'reserva' : 'principal';
}

/** Token do bot ativo. Vazio se não configurado. */
async function tokenAtivo() {
  const papel = await papelAtivo();
  const t = papel === 'reserva' ? tokenReserva() : tokenPrincipal();
  // Se o reserva foi ativado mas não tem token, cai no principal em vez de
  // deixar o funil mudo.
  return t || tokenPrincipal() || tokenReserva();
}

async function trocarPara(papel, motivo) {
  const alvo = papel === 'reserva' ? 'reserva' : 'principal';
  await setJSON(CHAVE_ATIVO, { papel: alvo, motivo: motivo || '', em: Date.now() });
  return alvo;
}

function segredoWebhook() { return process.env.TELEGRAM_WEBHOOK_SECRET || ''; }
function caminhoWebhook() { return process.env.TELEGRAM_WEBHOOK_PATH || ''; }
function donoId() { return String(process.env.BOT_OWNER_ID || '').trim(); }

/** URL pública do site, sem barra no fim. Base dos links de CTA. */
function baseUrl() {
  return String(process.env.PUBLIC_BASE_URL || 'https://onlyagatinha.pages.dev').replace(/\/+$/, '');
}

/** true quando o bot tem o mínimo para funcionar. */
function configurado() {
  return Boolean(tokenPrincipal() && segredoWebhook() && caminhoWebhook());
}

module.exports = {
  tokenPrincipal, tokenReserva, tokenAtivo, papelAtivo, trocarPara,
  segredoWebhook, caminhoWebhook, donoId, baseUrl, configurado,
  CHAVE_ATIVO,
};
