'use strict';

// Estado do bot no KV.
//
// Duas regras que valem para tudo aqui:
//  1. Um documento por pessoa. O KV não tem transação, então nunca existe um
//     índice único com todo mundo dentro — a disputa de escrita fica sendo
//     "a pessoa clicando duas vezes", que é inofensiva.
//  2. Índice é palpite, o documento é a verdade. Quem lê `bot/exp/<dia>/` tem
//     obrigação de reler `bot/subs/<uid>` antes de agir.

const { getJSON, setJSON, listKeys, del, dayKey } = require('../store');
const { PLAN_DAYS } = require('../members');

const DIA_MS = 24 * 3600 * 1000;

/* ---------- chaves ---------- */

const kUser = (uid) => `bot/u/${uid}.json`;
const kSub = (uid) => `bot/subs/${uid}.json`;
const kOrder = (txid) => `bot/order/${txid}.json`;
const kToken = (tok) => `bot/tok/${tok}.json`;
const kCust = (hash) => `bot/bycust/${hash}.json`;
const kExp = (dia, uid) => `bot/exp/${dia}/${uid}`;

/* ---------- utilidades ---------- */

// Hash do identificador do cliente (e-mail/telefone). Guardar o e-mail cru numa
// chave de KV vazaria dado pessoal em qualquer listagem ou backup.
async function hashCust(valor) {
  const dados = new TextEncoder().encode(String(valor || '').toLowerCase().trim());
  const buf = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buf)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenAleatorio(tam = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(tam));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, tam);
}

/** Dia (BRT) de um timestamp — mesma convenção do resto do painel. */
const diaDe = (ts) => dayKey(ts);

/** Dias de validade de um plano, reaproveitando a tabela do painel. */
function diasDoPlano(plan) {
  return PLAN_DAYS[plan] || PLAN_DAYS.mensal || 30;
}

/**
 * Nova data de vencimento. EMPILHA em cima do que ainda resta, em vez de
 * resetar: quem renova adiantado não perde os dias que já pagou.
 */
function novoVencimento(plan, vencimentoAtual) {
  const base = Math.max(Date.now(), Number(vencimentoAtual) || 0);
  return base + diasDoPlano(plan) * DIA_MS;
}

/* ---------- usuário / conversa ---------- */

async function getUser(uid) {
  return await getJSON(kUser(uid));
}

async function saveUser(u) {
  u.updatedAt = Date.now();
  await setJSON(kUser(u.uid), u);
  return u;
}

/** Carrega ou cria o registro da conversa. */
async function ensureUser(from, chatId) {
  const uid = String(from.id);
  const existente = await getUser(uid);
  if (existente) {
    existente.lastSeenAt = Date.now();
    if (chatId) existente.chatId = chatId;
    if (from.username) existente.username = from.username;
    return existente;
  }
  return {
    uid,
    chatId: chatId || uid,
    username: from.username || '',
    first: from.first_name || '',
    state: 'new',
    step: 0,
    ageOkAt: 0,
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
    src: '',
    tgtok: '',
    ctaClicks: 0,
    reissues: 0,
    blocked: false,
  };
}

/** Marca que o bot foi bloqueado — o cron para de gastar requisição com ele. */
async function marcarBloqueado(uid) {
  const u = await getUser(uid);
  if (!u || u.blocked) return;
  u.blocked = true;
  await saveUser(u);
}

/**
 * Limite por pessoa. O rate limit existente do projeto não serve aqui: ele
 * conta por IP, e todo o tráfego do webhook chega dos IPs do Telegram.
 * Como o documento do usuário já vai ser lido de qualquer jeito, o custo é zero.
 */
function dentroDoLimite(u, { limite = 25, janelaMs = 60000 } = {}) {
  const agora = Date.now();
  const aberta = u.rl && agora - (u.rl.win || 0) < janelaMs;
  u.rl = aberta ? u.rl : { win: agora, n: 0 };
  u.rl.n += 1;
  return u.rl.n <= limite;
}

/* ---------- token do CTA ---------- */

/** Token que vai na URL da LP (?tg=) e permite reconhecer o comprador depois. */
async function garantirToken(u) {
  if (u.tgtok) return u.tgtok;
  const tok = tokenAleatorio(16);
  await setJSON(kToken(tok), { uid: u.uid, at: Date.now() });
  u.tgtok = tok;
  return tok;
}

async function uidPorToken(tok) {
  const doc = await getJSON(kToken(String(tok || '')));
  return doc && doc.uid ? String(doc.uid) : null;
}

/* ---------- índice por e-mail/telefone (renovações) ---------- */

async function vincularCliente(custKey, uid, extra = {}) {
  if (!custKey) return;
  const h = await hashCust(custKey);
  const atual = (await getJSON(kCust(h))) || { orderIds: [] };
  const doc = {
    uid: String(uid),
    orderIds: Array.from(new Set([...(atual.orderIds || []), ...(extra.orderIds || [])])),
    lastPaidAt: extra.lastPaidAt || atual.lastPaidAt || Date.now(),
    plan: extra.plan || atual.plan || '',
  };
  await setJSON(kCust(h), doc);
}

async function uidPorCliente(custKey) {
  if (!custKey) return null;
  const doc = await getJSON(kCust(await hashCust(custKey)));
  return doc && doc.uid ? String(doc.uid) : null;
}

/* ---------- pedido -> uid (e trava de idempotência) ---------- */

const getOrderLink = (txid) => getJSON(kOrder(txid));

async function saveOrderLink(txid, dados) {
  const atual = (await getOrderLink(txid)) || {};
  await setJSON(kOrder(txid), { ...atual, ...dados, updatedAt: Date.now() });
}

/* ---------- assinatura ---------- */

const getSub = (uid) => getJSON(kSub(uid));

/**
 * Grava a assinatura e mantém o índice de expiração coerente.
 * Ordem importa: escreve o documento primeiro, só depois mexe no índice —
 * assim uma falha no meio deixa um palpite órfão (inofensivo), nunca uma
 * assinatura sem documento.
 */
async function saveSub(sub, diaAnterior) {
  sub.updatedAt = Date.now();
  sub.expDay = diaDe(sub.expiresAt);
  await setJSON(kSub(sub.uid), sub);

  if (diaAnterior && diaAnterior !== sub.expDay) {
    try { await del(kExp(diaAnterior, sub.uid)); } catch { /* palpite órfão não quebra nada */ }
  }
  // `pending_invite` também entra no índice: é gente que PAGOU e só não recebeu
  // o convite (grupo não vinculado, bot sem permissão). Deixar de fora faria
  // essas pessoas nunca serem avisadas nem vencerem — some do radar do cron.
  if (sub.status === 'active' || sub.status === 'grace' || sub.status === 'pending_invite') {
    await setJSON(kExp(sub.expDay, sub.uid), {
      uid: sub.uid, chatKey: sub.chatKey || 'vip', expiresAt: sub.expiresAt,
    });
  } else {
    try { await del(kExp(sub.expDay, sub.uid)); } catch { /* idem */ }
  }
  return sub;
}

/** Palpites de vencimento de um dia. Sempre confira o documento antes de agir. */
async function listarExpiracoes(dia) {
  const chaves = await listKeys(`bot/exp/${dia}/`);
  const docs = await Promise.all(chaves.map((k) => getJSON(k)));
  return docs.filter(Boolean);
}

/** Varredura completa — usada só pela reconciliação semanal. */
async function listarAssinaturas() {
  const chaves = await listKeys('bot/subs/');
  const docs = await Promise.all(chaves.map((k) => getJSON(k)));
  return docs.filter(Boolean);
}

/* ---------- eventos ---------- */

/**
 * Eventos do bot vão para `bev/`, NUNCA para `ev/`.
 * O agregador do funil cria uma linha na tabela de origens para todo evento
 * que encontra, antes mesmo de olhar o tipo — e cacheia dias fechados para
 * sempre. Um evento do bot ali sujaria o relatório de tráfego de forma
 * irreversível. A atribuição real acontece sozinha quando a pessoa clica no
 * CTA e cai na LP com utm_source=telegram.
 */
// 60 dias, não 30: a margem entre o evento bruto e o resumo diário é o que
// separa "dado consolidado" de "dado perdido porque o agendador ficou fora do
// ar por uns dias".
const EVENTO_TTL_S = 60 * 24 * 3600;

async function evento(tipo, dados = {}) {
  const ts = Date.now();
  try {
    await setJSON(
      `bev/${diaDe(ts)}/${ts}-${tokenAleatorio(6)}.json`,
      { e: tipo, ...dados, ts },
      { expirationTtl: EVENTO_TTL_S }
    );
  } catch { /* métrica nunca derruba fluxo */ }
}

module.exports = {
  kUser, kSub, kOrder, kToken, kCust, kExp,
  hashCust, tokenAleatorio, diaDe, diasDoPlano, novoVencimento, DIA_MS,
  getUser, saveUser, ensureUser, marcarBloqueado, dentroDoLimite,
  garantirToken, uidPorToken,
  vincularCliente, uidPorCliente,
  getOrderLink, saveOrderLink,
  getSub, saveSub, listarExpiracoes, listarAssinaturas,
  evento,
};
