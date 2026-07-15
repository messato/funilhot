'use strict';

// Configurações editáveis pelo painel (preços, links, textos, limiares).
// Guardadas em config/settings.json e mescladas com os padrões abaixo.
const { getJSON, setJSON } = require('./store');

const DEFAULTS = {
  prices: {
    'checkout/mensal': 3990,
    'checkout/trimestral': 9790,
    'checkout/anual': 29700,
    'upsell/mensal': 4990,
    'upsell/trimestral': 14990,
    'downsell/mensal': 3990,
    'downsell/trimestral': 11990,
  },
  vipLink: 'https://t.me/+LINK_DO_GRUPO_VIP',
  supportLink: 'https://t.me/suporte_agatha',
  recoveryMsg: 'Oi {nome}! Vi que você gerou o PIX do {produto} mas não finalizou. Posso te ajudar a concluir?',
  abandonMinutes: 10,
};

async function getSettings() {
  const saved = (await getJSON('config/settings.json')) || {};
  return {
    prices: Object.assign({}, DEFAULTS.prices, saved.prices || {}),
    vipLink: saved.vipLink || DEFAULTS.vipLink,
    supportLink: saved.supportLink || DEFAULTS.supportLink,
    recoveryMsg: saved.recoveryMsg || DEFAULTS.recoveryMsg,
    abandonMinutes: typeof saved.abandonMinutes === 'number' ? saved.abandonMinutes : DEFAULTS.abandonMinutes,
  };
}

function safeUrl(v, fallback) {
  const s = String(v || '').trim().slice(0, 300);
  return /^https?:\/\//i.test(s) ? s : fallback;
}

// Valida e grava um patch parcial. Preços em CENTAVOS (inteiros).
async function saveSettings(patch) {
  const cur = (await getJSON('config/settings.json')) || {};
  const next = Object.assign({}, cur);

  if (patch.prices && typeof patch.prices === 'object') {
    next.prices = Object.assign({}, cur.prices || {});
    for (const key of Object.keys(DEFAULTS.prices)) {
      const cents = Math.round(Number(patch.prices[key]));
      if (Number.isFinite(cents) && cents >= 100 && cents <= 5000000) next.prices[key] = cents;
    }
  }
  if ('vipLink' in patch) next.vipLink = safeUrl(patch.vipLink, DEFAULTS.vipLink);
  if ('supportLink' in patch) next.supportLink = safeUrl(patch.supportLink, DEFAULTS.supportLink);
  if ('recoveryMsg' in patch) next.recoveryMsg = String(patch.recoveryMsg || '').slice(0, 500);
  if ('abandonMinutes' in patch) {
    const m = Math.round(Number(patch.abandonMinutes));
    if (Number.isFinite(m) && m >= 1 && m <= 1440) next.abandonMinutes = m;
  }

  await setJSON('config/settings.json', next);
  return getSettings();
}

// Só o que é seguro expor publicamente (usado pelas páginas do funil).
function publicView(s) {
  return { prices: s.prices, vipLink: s.vipLink, supportLink: s.supportLink };
}

module.exports = { DEFAULTS, getSettings, saveSettings, publicView };
