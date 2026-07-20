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
  // Financeiro (DRE / recebíveis)
  taxRatePct: 6,       // alíquota estimada sobre o faturamento (Simples)
  pixReleaseDays: 1,   // D+ em que o PIX é liberado pelo gateway
  // Conteúdo editável da landing (vazio = mantém o que está no HTML).
  siteName: '',
  siteUser: '',
  siteBioTitle: '',
  siteBioText: '',
  siteStats: '',
  // Versões das imagens enviadas (0 = usar a imagem padrão do HTML). Servem de cache-buster.
  avatarVer: 0,
  capaVer: 0,
  logoVer: 0,
  // Níveis VIP (planejamento de grupos/preços). price em CENTAVOS.
  vipLevels: [
    { name: 'VIP', price: 3990, link: '' },
    { name: 'VIP+', price: 9790, link: '' },
  ],
  // Depoimentos exibidos na landing (prova social).
  testimonials: [],
  // Afiliados/embaixadores: code (slug), commissionPct (%). Interno (não vai ao público).
  affiliates: [],
  // Cupons de desconto. type: 'pct' (%) ou 'fixed' (centavos). Interno (validado no servidor).
  coupons: [],
  // Order bump: adicional opcional no checkout. price em CENTAVOS.
  orderBump: { enabled: false, label: 'Pack extra de fotos', desc: 'Leve também 30 fotos exclusivas por um precinho.', price: 1990 },
};

const TEXT_FIELDS = ['siteName', 'siteUser', 'siteBioTitle', 'siteBioText', 'siteStats'];
const VER_FIELDS = ['avatarVer', 'capaVer', 'logoVer'];
// Campos numéricos com faixa própria: [min, max].
const NUM_FIELDS = { taxRatePct: [0, 60], pixReleaseDays: [0, 90] };
function cleanText(v, max) { return String(v == null ? '' : v).replace(/[<>]/g, '').slice(0, max || 200); }

async function getSettings() {
  const saved = (await getJSON('config/settings.json')) || {};
  const out = {
    prices: Object.assign({}, DEFAULTS.prices, saved.prices || {}),
    vipLink: saved.vipLink || DEFAULTS.vipLink,
    supportLink: saved.supportLink || DEFAULTS.supportLink,
    recoveryMsg: saved.recoveryMsg || DEFAULTS.recoveryMsg,
    abandonMinutes: typeof saved.abandonMinutes === 'number' ? saved.abandonMinutes : DEFAULTS.abandonMinutes,
  };
  TEXT_FIELDS.forEach((f) => { out[f] = typeof saved[f] === 'string' ? saved[f] : DEFAULTS[f]; });
  VER_FIELDS.forEach((f) => { out[f] = typeof saved[f] === 'number' ? saved[f] : DEFAULTS[f]; });
  Object.keys(NUM_FIELDS).forEach((f) => { out[f] = typeof saved[f] === 'number' ? saved[f] : DEFAULTS[f]; });
  out.vipLevels = Array.isArray(saved.vipLevels) ? saved.vipLevels : DEFAULTS.vipLevels;
  out.testimonials = Array.isArray(saved.testimonials) ? saved.testimonials : DEFAULTS.testimonials;
  out.affiliates = Array.isArray(saved.affiliates) ? saved.affiliates : DEFAULTS.affiliates;
  out.coupons = Array.isArray(saved.coupons) ? saved.coupons : DEFAULTS.coupons;
  out.orderBump = Object.assign({}, DEFAULTS.orderBump, saved.orderBump || {});
  return out;
}

function cleanCoupons(arr) {
  if (!Array.isArray(arr)) return null;
  const seen = {};
  return arr.slice(0, 50).map((c) => {
    const type = (c && c.type) === 'fixed' ? 'fixed' : 'pct';
    let value = Math.round(Number(c && c.value));
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (type === 'pct') value = Math.min(90, value);        // até 90%
    else value = Math.min(5000000, value);                   // centavos
    const maxUses = Math.max(0, Math.round(Number(c && c.maxUses)) || 0); // 0 = ilimitado
    return {
      code: String(c && c.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
      type, value,
      active: c && c.active !== false,
      maxUses, uses: Math.max(0, Math.round(Number(c && c.uses)) || 0),
    };
  }).filter((c) => c.code && c.value > 0 && !seen[c.code] && (seen[c.code] = 1));
}
function cleanOrderBump(o) {
  if (!o || typeof o !== 'object') return null;
  const price = Math.round(Number(o.price));
  return {
    enabled: !!o.enabled,
    label: cleanText(o.label, 80) || 'Adicional',
    desc: cleanText(o.desc, 160),
    price: Number.isFinite(price) && price >= 100 && price <= 5000000 ? price : DEFAULTS.orderBump.price,
  };
}

function cleanVipLevels(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 6).map((lv) => {
    const price = Math.round(Number(lv && lv.price));
    return {
      name: cleanText(lv && lv.name, 40) || 'VIP',
      price: Number.isFinite(price) && price >= 100 && price <= 5000000 ? price : 0,
      link: /^https?:\/\//i.test(String(lv && lv.link || '')) ? String(lv.link).slice(0, 300) : '',
    };
  }).filter((lv) => lv.price > 0);
}

function cleanTestimonials(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 30).map((t) => {
    const rating = Math.round(Number(t && t.rating));
    return {
      name: cleanText(t && t.name, 40) || 'Cliente',
      uf: cleanText(t && t.uf, 4),
      text: cleanText(t && t.text, 240),
      rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : 5,
    };
  }).filter((t) => t.text);
}

function slugify(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16); }
function cleanAffiliates(arr) {
  if (!Array.isArray(arr)) return null;
  const seen = {};
  return arr.slice(0, 100).map((a) => {
    const pct = Number(a && a.commissionPct);
    return {
      name: cleanText(a && a.name, 40) || 'Afiliado',
      code: slugify(a && a.code),
      commissionPct: Number.isFinite(pct) && pct >= 0 && pct <= 90 ? Math.round(pct * 100) / 100 : 0,
    };
  }).filter((a) => a.code && !seen[a.code] && (seen[a.code] = 1));
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
  TEXT_FIELDS.forEach((f) => {
    if (f in patch) next[f] = cleanText(patch[f], f === 'siteBioText' ? 600 : 160);
  });
  VER_FIELDS.forEach((f) => {
    if (f in patch) { const n = Math.round(Number(patch[f])); if (Number.isFinite(n) && n >= 0) next[f] = n; }
  });
  Object.keys(NUM_FIELDS).forEach((f) => {
    if (f in patch) {
      const [min, max] = NUM_FIELDS[f];
      const n = Number(patch[f]);
      if (Number.isFinite(n) && n >= min && n <= max) next[f] = Math.round(n * 100) / 100;
    }
  });
  if ('vipLevels' in patch) {
    const lv = cleanVipLevels(patch.vipLevels);
    if (lv) next.vipLevels = lv;
  }
  if ('testimonials' in patch) {
    const t = cleanTestimonials(patch.testimonials);
    if (t) next.testimonials = t;
  }
  if ('affiliates' in patch) {
    const a = cleanAffiliates(patch.affiliates);
    if (a) next.affiliates = a;
  }
  if ('coupons' in patch) {
    const c = cleanCoupons(patch.coupons);
    if (c) next.coupons = c;
  }
  if ('orderBump' in patch) {
    const ob = cleanOrderBump(patch.orderBump);
    if (ob) next.orderBump = ob;
  }

  await setJSON('config/settings.json', next);
  return getSettings();
}

// Marca uma imagem como atualizada (novo cache-buster). name: avatar|capa|logo.
async function bumpMedia(name, ts) {
  const field = name + 'Ver';
  if (VER_FIELDS.indexOf(field) < 0) return null;
  const patch = {}; patch[field] = ts || 1;
  return saveSettings(patch);
}

// Conta um resgate de cupom (chamado quando o pedido é pago).
async function incrementCouponUse(code) {
  const norm = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!norm) return;
  const cur = (await getJSON('config/settings.json')) || {};
  if (!Array.isArray(cur.coupons)) return;
  const c = cur.coupons.find((x) => x.code === norm);
  if (!c) return;
  c.uses = (c.uses || 0) + 1;
  await setJSON('config/settings.json', cur);
}

// Só o que é seguro expor publicamente (usado pelas páginas do funil).
function publicView(s) {
  const out = {
    prices: s.prices, vipLink: s.vipLink, supportLink: s.supportLink,
    testimonials: s.testimonials || [],
    // Order bump é exibido no checkout (sem o preço-base sensível). Cupons NÃO vão ao público.
    orderBump: s.orderBump && s.orderBump.enabled
      ? { enabled: true, label: s.orderBump.label, desc: s.orderBump.desc, price: s.orderBump.price }
      : { enabled: false },
  };
  TEXT_FIELDS.forEach((f) => { out[f] = s[f]; });
  VER_FIELDS.forEach((f) => { out[f] = s[f]; });
  return out;
}

// Valida um cupom (server-side). Retorna o cupom ou null.
function findValidCoupon(s, rawCode) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  if (!code) return null;
  const c = (s.coupons || []).find((x) => x.code === code && x.active);
  if (!c) return null;
  if (c.maxUses && c.uses >= c.maxUses) return null;
  return c;
}
// Aplica o desconto (nunca abaixo de R$1). Retorna { amount, discount }.
function applyCoupon(amount, coupon) {
  if (!coupon) return { amount, discount: 0 };
  let discount = coupon.type === 'fixed' ? coupon.value : Math.round(amount * coupon.value / 100);
  discount = Math.max(0, Math.min(discount, amount - 100));
  return { amount: amount - discount, discount };
}

module.exports = { DEFAULTS, getSettings, saveSettings, publicView, bumpMedia, findValidCoupon, applyCoupon, incrementCouponUse };
