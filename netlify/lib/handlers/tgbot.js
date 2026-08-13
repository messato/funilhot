'use strict';

// Webhook do bot de prévias.
//
// Duas regras inegociáveis deste arquivo:
//  1. Responder 200 SEMPRE (menos quando o segredo não bate). Qualquer outro
//     código faz o Telegram reentregar o update em laço e transformar um erro
//     pontual numa tempestade.
//  2. O segredo é a autenticação. Sem ele, nada é lido do KV.

const { getJSON, setJSON } = require('../store');
const cfg = require('../bot/config');
const st = require('../bot/state');
const chats = require('../bot/chats');
const previews = require('../bot/previews');
const tg = require('../telegram');

const OK = { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' };
const NEGADO = { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: '{"ok":false}' };

/** Comparação em tempo constante — mesmo padrão do adminauth do projeto. */
function segredoConfere(recebido, esperado) {
  const a = String(recebido || '');
  const b = String(esperado || '');
  if (!b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/** O Telegram reentrega updates; processar duas vezes duplicaria mensagens. */
async function jaProcessado(updateId) {
  if (!updateId) return false;
  const chave = `tmp/seen/${updateId}`;
  if (await getJSON(chave)) return true;
  await setJSON(chave, { at: Date.now() }, { expirationTtl: 3600 });
  return false;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return NEGADO;

  const headers = event.headers || {};
  if (!segredoConfere(headers['x-telegram-bot-api-secret-token'], cfg.segredoWebhook())) {
    return NEGADO;
  }

  let upd;
  try {
    upd = JSON.parse(event.body || '{}');
  } catch {
    return OK; // corpo inválido: não adianta o Telegram reenviar
  }

  try {
    if (await jaProcessado(upd.update_id)) return OK;
    const token = await cfg.tokenAtivo();
    if (token) await rotear(token, upd);
  } catch (error) {
    // Engolir de propósito: ver regra 1 no topo.
    console.error('tgbot erro:', error && error.message);
  }
  return OK;
};

/* ---------- roteamento ---------- */

async function rotear(token, upd) {
  if (upd.my_chat_member) {
    await chats.aoMudarStatus(token, upd.my_chat_member);
    return;
  }
  if (upd.message && upd.message.migrate_to_chat_id) {
    await chats.aoMigrar(upd.message.chat.id, upd.message.migrate_to_chat_id);
    return;
  }
  if (upd.callback_query) {
    await aoClicar(token, upd.callback_query);
    return;
  }
  if (upd.message) {
    await aoReceberMensagem(token, upd.message);
    return;
  }
  // chat_member e chat_join_request entram na fase de entrada automática.
}

/* ---------- cliques nos botões ---------- */

async function aoClicar(token, cq) {
  const from = cq.from || {};
  const dados = String(cq.data || '');
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  if (!from.id || !chatId) return;

  // Sem isso o botão fica girando para sempre no aparelho da pessoa.
  await tg.answerCallbackQuery(token, cq.id);

  const u = await st.ensureUser(from, chatId);
  if (!st.dentroDoLimite(u)) { await st.saveUser(u); return; }

  // Tira o botão já usado da mensagem anterior, para não repetir o passo.
  if (cq.message.message_id) {
    await tg.editMessageReplyMarkup(token, chatId, cq.message.message_id, { inline_keyboard: [] });
  }

  if (dados === 'age:no') {
    u.state = 'blocked';
    await tg.sendMessage(token, chatId, 'Sem problema 💛 esse conteúdo é só para maiores de 18.');
  } else if (dados === 'age:ok') {
    u.ageOkAt = Date.now();
    u.state = 'previewing';
    await st.evento('bot_age_ok', { uid: u.uid });
    await tg.sendMessage(token, chatId, 'Boa 😏 então vem comigo…');
    await previews.enviarPrevia(token, u, 0);
  } else {
    const m = dados.match(/^p:(\d+):(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      const versao = parseInt(m[2], 10);
      const cat = await previews.getCatalogo();
      // Catálogo mudou depois que o botão foi enviado: os índices não valem mais.
      if (versao !== cat.v) {
        await tg.sendMessage(token, chatId, 'Atualizei as prévias — segue daqui 👇');
        await previews.enviarPrevia(token, u, Math.min(u.step || 0, cat.items.length));
      } else {
        await previews.enviarPrevia(token, u, idx);
      }
    }
  }

  await st.saveUser(u);
}

async function aoReceberMensagem(token, msg) {
  const chat = msg.chat || {};
  // Em grupo o bot não conversa: só registra (tratado em my_chat_member).
  if (chat.type !== 'private') return;

  const from = msg.from || {};
  if (!from.id || from.is_bot) return;

  const u = await st.ensureUser(from, chat.id);
  if (!st.dentroDoLimite(u)) { await st.saveUser(u); return; }

  // Mídia mandada pelo dono vira prévia no catálogo — dispensa tela de upload.
  const dono = cfg.donoId();
  if (dono && String(from.id) === dono && (msg.video || msg.photo || msg.animation)) {
    const r = await previews.adicionarDoDono(token, msg);
    await tg.sendMessage(
      token, u.chatId,
      r.ok ? `✅ Prévia cadastrada (agora são ${r.total}).\n\nLegenda: ${r.item.caption ? tg.esc(r.item.caption) : '<i>sem legenda — dá para editar no painel</i>'}`
           : `❌ ${tg.esc(r.erro)}`
    );
    await st.saveUser(u);
    return;
  }

  const texto = String(msg.text || '').trim();

  if (/^\/start\b/.test(texto)) {
    const payload = texto.replace(/^\/start\s*/, '').slice(0, 64);
    await comandoStart(token, u, payload);
  } else if (/^\/suporte\b/.test(texto)) {
    await tg.sendMessage(token, u.chatId, 'Precisa de ajuda? Me chama por aqui que eu te respondo 💬');
  } else if (/^\/(acesso|status)\b/.test(texto)) {
    await tg.sendMessage(token, u.chatId, 'Esse comando entra em breve 🙈');
  } else if (u.ageOkAt) {
    // Já passou pelo gate: retoma de onde parou em vez de mandar recomeçar.
    await previews.enviarPrevia(token, u, u.step || 0);
  } else {
    await tg.sendMessage(token, u.chatId, 'Manda /start que eu te mostro o que separei 😏');
  }

  await st.saveUser(u);
}

async function comandoStart(token, u, payload) {
  // s_<origem> diz de onde a pessoa veio (s_ig, s_tiktok, s_x...).
  if (/^s_[a-z0-9_-]{1,20}$/i.test(payload)) u.src = payload.slice(2).toLowerCase();

  if (u.state === 'new') {
    u.state = 'age_gate';
    await st.evento('bot_start', { uid: u.uid, src: u.src || '' });
  }

  const nome = u.first ? ', ' + tg.esc(u.first) : '';
  await tg.sendMessage(
    token,
    u.chatId,
    `Oi${nome} 😏\n\nAntes de eu te mostrar o que separei… você é maior de 18?`,
    { reply_markup: tg.teclado([[tg.botao('Sim, sou maior 🔥', 'age:ok'), tg.botao('Não', 'age:no')]]) }
  );
}
