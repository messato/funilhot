'use strict';

// Cliente único da Bot API do Telegram.
// Antes desta lib o sendMessage estava duplicado inline em orders.js e em
// daily-summary.mjs; os dois passam a chamar daqui.
//
// Regras que valem para todo o projeto:
//  - erros de rede/5xx são reenviados com backoff; 429 respeita o retry_after;
//  - erros terminais (bot bloqueado, chat inexistente, conta desativada) NÃO
//    são reenviados — viram { ok:false, terminal:true } pra quem chamou marcar
//    o usuário e parar de gastar requisição com ele.

const API = 'https://api.telegram.org/bot';

// Erros que não adianta repetir: a condição não muda com o tempo.
const TERMINAIS = [
  'bot was blocked by the user',
  'user is deactivated',
  'chat not found',
  'bot was kicked',
  'have no rights to send a message',
  'user not found',
  "can't remove chat owner",
  'not enough rights',
  'peer_id_invalid',
];

function ehTerminal(desc) {
  const d = String(desc || '').toLowerCase();
  return TERMINAIS.some((t) => d.includes(t));
}

// Recusa por formatação. Não é erro de rede nem de permissão: o texto tem HTML
// que o Telegram não aceita (um "<" solto, um "&" cru, tag não fechada).
// Sem tratar isso, a mensagem simplesmente não sai — e num envio em lote
// derruba a campanha inteira, uma pessoa de cada vez.
const RE_FORMATACAO = /can't parse entities|unsupported start tag|unclosed start tag|can't find end tag|entity/i;
function ehErroDeFormatacao(desc) {
  return RE_FORMATACAO.test(String(desc || ''));
}

/** Tira as tags e devolve as entidades ao texto puro. */
function semTags(texto) {
  return String(texto == null ? '' : texto)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama um método da Bot API.
 * @returns {Promise<{ok:boolean, result?:any, error?:string, terminal?:boolean, retryAfter?:number}>}
 * Nunca lança: quem chama trata pelo campo ok.
 */
async function call(token, method, params = {}, opts = {}) {
  const tentativas = opts.retries == null ? 2 : opts.retries;

  for (let i = 0; i <= tentativas; i++) {
    let res;
    try {
      res = await fetch(API + token + '/' + method, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } catch (error) {
      // Falha de rede: vale reenviar.
      if (i === tentativas) return { ok: false, error: 'network: ' + error.message };
      await dormir(300 * (i + 1));
      continue;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, description: 'resposta ilegível (HTTP ' + res.status + ')' };
    }

    if (data.ok) return { ok: true, result: data.result };

    const desc = data.description || ('HTTP ' + res.status);

    // 429: o Telegram diz em quantos segundos podemos voltar.
    if (res.status === 429) {
      const espera = (data.parameters && data.parameters.retry_after) || 1;
      if (i === tentativas || espera > 30) {
        return { ok: false, error: desc, retryAfter: espera };
      }
      await dormir(espera * 1000);
      continue;
    }

    if (ehTerminal(desc)) return { ok: false, error: desc, terminal: true };

    // 5xx é instabilidade do lado deles; 4xx restante é erro nosso, não repete.
    if (res.status >= 500 && i < tentativas) {
      await dormir(400 * (i + 1));
      continue;
    }
    return { ok: false, error: desc };
  }
  return { ok: false, error: 'esgotou as tentativas' };
}

/* ---------- mensagens ---------- */

/**
 * Envia texto. Se o Telegram recusar por formatação, reenvia UMA vez sem
 * formatação: perder o negrito é muito melhor do que a pessoa não receber nada.
 */
async function sendMessage(token, chatId, text, extra = {}) {
  const params = { chat_id: chatId, text, parse_mode: 'HTML', ...extra };
  const r = await call(token, 'sendMessage', params);
  if (r.ok || !params.parse_mode || !ehErroDeFormatacao(r.error)) return r;

  console.error('texto com HTML inválido, reenviando sem formatação:', r.error);
  const limpo = { ...params, text: semTags(params.text) };
  delete limpo.parse_mode;
  const r2 = await call(token, 'sendMessage', limpo);
  return r2.ok ? { ...r2, degradado: true } : r2;
}

// copyMessage é o jeito certo de reenviar as prévias: não marca "encaminhado",
// aceita protect_content e — o mais importante — sobrevive à troca de bot,
// diferente do file_id, que só vale pro bot que o recebeu.
async function copyMessage(token, chatId, fromChatId, messageId, extra = {}) {
  const params = { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...extra };
  const r = await call(token, 'copyMessage', params);
  if (r.ok || !params.parse_mode || !ehErroDeFormatacao(r.error)) return r;

  // Mesma rede de segurança do sendMessage: uma legenda com "<" ou "&" fazia a
  // prévia não chegar, e o lead ficava no vácuo depois de clicar "ver mais".
  console.error('legenda com HTML inválido, reenviando sem formatação:', r.error);
  const limpo = { ...params, caption: semTags(params.caption) };
  delete limpo.parse_mode;
  const r2 = await call(token, 'copyMessage', limpo);
  return r2.ok ? { ...r2, degradado: true } : r2;
}

const editMessageReplyMarkup = (token, chatId, messageId, replyMarkup) =>
  call(token, 'editMessageReplyMarkup', {
    chat_id: chatId, message_id: messageId, reply_markup: replyMarkup || { inline_keyboard: [] },
  });

// Obrigatório em todo callback_query, senão o app do usuário fica com o
// botão girando pra sempre.
const answerCallbackQuery = (token, id, extra = {}) =>
  call(token, 'answerCallbackQuery', { callback_query_id: id, ...extra }, { retries: 0 });

/* ---------- convites e acesso ---------- */

const createChatInviteLink = (token, chatId, params = {}) =>
  call(token, 'createChatInviteLink', { chat_id: chatId, ...params });

const revokeChatInviteLink = (token, chatId, inviteLink) =>
  call(token, 'revokeChatInviteLink', { chat_id: chatId, invite_link: inviteLink });

const approveChatJoinRequest = (token, chatId, userId) =>
  call(token, 'approveChatJoinRequest', { chat_id: chatId, user_id: userId });

const declineChatJoinRequest = (token, chatId, userId) =>
  call(token, 'declineChatJoinRequest', { chat_id: chatId, user_id: userId });

const banChatMember = (token, chatId, userId, extra = {}) =>
  call(token, 'banChatMember', { chat_id: chatId, user_id: userId, ...extra });

const unbanChatMember = (token, chatId, userId) =>
  call(token, 'unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true });

/**
 * Remove alguém do grupo SEM deixar banido.
 * O par ban+unban é obrigatório: só o ban deixaria a pessoa impedida de voltar
 * até se comprasse de novo — que é o pior defeito possível aqui.
 */
async function removeMember(token, chatId, userId) {
  const ban = await banChatMember(token, chatId, userId);
  // Dono do grupo não pode ser removido; tratamos como "resolvido", senão o
  // cron tentaria de novo todo dia pra sempre.
  if (!ban.ok && /can't remove chat owner/i.test(ban.error || '')) {
    return { ok: false, owner: true, error: ban.error };
  }
  if (!ban.ok) return ban;
  const unban = await unbanChatMember(token, chatId, userId);
  return { ok: true, unbanned: unban.ok, unbanError: unban.ok ? null : unban.error };
}

/* ---------- chat / admin ---------- */

const getChat = (token, chatId) => call(token, 'getChat', { chat_id: chatId });
const getChatAdministrators = (token, chatId) => call(token, 'getChatAdministrators', { chat_id: chatId });
const getChatMember = (token, chatId, userId) => call(token, 'getChatMember', { chat_id: chatId, user_id: userId });
const getMe = (token) => call(token, 'getMe', {}, { retries: 1 });

/* ---------- webhook ---------- */

// Duas pegadinhas aqui:
//  - chat_member não vem por padrão: sem pedir, o bot nunca sabe quem entrou
//    ou saiu do grupo;
//  - mensagem publicada em CANAL chega como channel_post, não como message —
//    sem isso, comando nenhum funciona dentro de canal.
const UPDATES = [
  'message', 'channel_post', 'callback_query',
  'my_chat_member', 'chat_member', 'chat_join_request',
];

const setWebhook = (token, url, secret) =>
  call(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: UPDATES,
    drop_pending_updates: true,
    max_connections: 40,
  });

const deleteWebhook = (token) => call(token, 'deleteWebhook', { drop_pending_updates: false });
const getWebhookInfo = (token) => call(token, 'getWebhookInfo');

/* ---------- utilidades ---------- */

// Escapa texto que vai dentro de parse_mode HTML.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tags que o Telegram aceita em parse_mode HTML.
const TAGS_OK = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'span', 'blockquote', 'tg-spoiler'];

/**
 * Confere se um texto é HTML válido para o Telegram ANTES de gravar.
 * Rejeitar aqui é o único momento em que a pessoa está olhando para a tela e
 * pode consertar — depois, o erro só apareceria como mensagem não entregue.
 * @returns {{ok:boolean, erro?:string}}
 */
function validarHtml(texto) {
  const s = String(texto == null ? '' : texto);
  const semEntidade = /&(?!(amp|lt|gt|quot|#\d+);)/;
  const pilha = [];
  const re = /<(\/?)([a-z0-9-]+)((?:\s[^>]*)?)>/gi;
  let m;
  let ultimo = 0;

  while ((m = re.exec(s))) {
    if (semEntidade.test(s.slice(ultimo, m.index))) {
      return { ok: false, erro: 'Use &amp; no lugar de & sozinho.' };
    }
    ultimo = re.lastIndex;

    const fechando = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!TAGS_OK.includes(tag)) {
      return { ok: false, erro: `A marcação <${tag}> não é aceita. Pode usar: ${TAGS_OK.slice(0, 6).join(', ')}.` };
    }
    if (tag === 'a' && !fechando && !/href\s*=\s*"(https?:\/\/|tg:\/\/)/i.test(m[3])) {
      return { ok: false, erro: 'Link precisa de href="https://…".' };
    }
    if (fechando) {
      if (pilha.pop() !== tag) return { ok: false, erro: `A marcação </${tag}> fecha algo que não foi aberto.` };
    } else {
      pilha.push(tag);
    }
  }

  if (semEntidade.test(s.slice(ultimo))) return { ok: false, erro: 'Use &amp; no lugar de & sozinho.' };
  // "<" que não chegou a formar marcação nenhuma (ex.: "preço < 50").
  if (/<(?![a-z/])/i.test(s)) return { ok: false, erro: 'Use &lt; no lugar de < sozinho.' };
  if (pilha.length) return { ok: false, erro: `Faltou fechar <${pilha[pilha.length - 1]}>.` };
  return { ok: true };
}

/**
 * Corta respeitando emoji: `.slice()` cru pode partir um emoji ao meio e gerar
 * texto inválido — e emoji em rótulo de botão aqui é regra, não exceção.
 */
function cortar(s, max) {
  return Array.from(String(s == null ? '' : s)).slice(0, max).join('');
}

const botao = (text, callback_data) => ({ text, callback_data });
const botaoUrl = (text, url) => ({ text, url });
const teclado = (linhas) => ({ inline_keyboard: linhas.filter((l) => l && l.length) });

/**
 * Envia em lote respeitando o limite de ~1 msg/s por chat e ~30/s global.
 * Devolve os resultados na mesma ordem. Usado pelo cron (avisos em massa).
 */
async function enviarEmLote(itens, fn, { espacoMs = 60, maximo = 200 } = {}) {
  const out = [];
  const fatia = itens.slice(0, maximo);
  for (const item of fatia) {
    out.push(await fn(item));
    if (espacoMs) await dormir(espacoMs);
  }
  return { resultados: out, processados: fatia.length, restantes: Math.max(0, itens.length - fatia.length) };
}

module.exports = {
  call,
  sendMessage, copyMessage, editMessageReplyMarkup, answerCallbackQuery,
  createChatInviteLink, revokeChatInviteLink,
  approveChatJoinRequest, declineChatJoinRequest,
  banChatMember, unbanChatMember, removeMember,
  getChat, getChatAdministrators, getChatMember, getMe,
  setWebhook, deleteWebhook, getWebhookInfo, UPDATES,
  esc, botao, botaoUrl, teclado, enviarEmLote,
  ehTerminal, ehErroDeFormatacao, semTags, validarHtml, cortar, TAGS_OK,
};
