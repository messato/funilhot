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
const access = require('../bot/access');
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
  if (upd.chat_join_request) {
    await aoPedirEntrada(token, upd.chat_join_request);
    return;
  }
  if (upd.chat_member) {
    await aoMudarMembro(upd.chat_member);
    return;
  }
  if (upd.message) {
    await aoReceberMensagem(token, upd.message);
    return;
  }
  // chat_member e chat_join_request entram na fase de entrada automática.
}

/* ---------- comandos do dono dentro do grupo ---------- */

// Chaves lógicas que o funil usa. 'cofre' guarda as mídias das prévias.
const CHAVES = {
  vip: 'grupo VIP (planos mensal e trimestral)',
  'vip-plus': 'grupo VIP+ (plano anual)',
  cofre: 'canal onde ficam guardadas as prévias',
};

/**
 * Vincular pelo próprio grupo evita ter que copiar id numérico para o painel:
 * o dono manda /vincular vip lá dentro e acabou.
 */
async function comandoDeGrupo(token, msg, chat) {
  const texto = String(msg.text || '').trim();
  const m = texto.match(/^\/vincular(?:@\w+)?\s+([a-z0-9-]+)/i);

  if (/^\/id\b/.test(texto)) {
    await tg.sendMessage(token, chat.id, `Id deste chat: <code>${chat.id}</code>`);
    return;
  }
  if (!m) {
    if (/^\/vincular/i.test(texto)) {
      const opcoes = Object.entries(CHAVES).map(([k, d]) => `<code>/vincular ${k}</code> — ${d}`).join('\n');
      await tg.sendMessage(token, chat.id, `Use uma destas:\n\n${opcoes}`);
    }
    return;
  }

  const chave = m[1].toLowerCase();
  if (!CHAVES[chave]) {
    await tg.sendMessage(token, chat.id, `Não conheço "${tg.esc(chave)}". Opções: ${Object.keys(CHAVES).join(', ')}`);
    return;
  }

  // Sem permissão o vínculo passa uma falsa sensação de pronto.
  const eu = await tg.getChatMember(token, chat.id, (await tg.getMe(token)).result.id);
  const status = eu.ok ? eu.result.status : '';
  if (status !== 'administrator' && status !== 'creator') {
    await tg.sendMessage(token, chat.id, '⚠️ Preciso ser <b>administrador</b> aqui antes de vincular.');
    return;
  }

  const modo = chave === 'cofre' ? 'invite' : 'request';
  const doc = await chats.vincular(chave, chat.id, { title: chat.title, joinMode: modo });

  const extra = chave === 'cofre'
    ? '\n\nAgora é só me mandar as prévias no privado que eu guardo aqui.'
    : `\n\nEntrada por aprovação: só quem tem assinatura ativa passa.`;
  await tg.sendMessage(token, chat.id, `✅ Vinculado como <b>${chave}</b> — ${CHAVES[chave]}.${extra}`);
  await st.evento('bot_chat_bind', { chave, chatId: String(doc.chatId) });
}

/* ---------- entrada no grupo ---------- */

/**
 * Pedido de entrada (modo 'request'): só aprova quem tem assinatura em dia.
 * É esta checagem — e não o convite de uso único — que garante que quem entra
 * é o comprador, e não alguém que recebeu o link repassado.
 */
async function aoPedirEntrada(token, req) {
  const uid = String(req.from && req.from.id);
  const chatId = req.chat && req.chat.id;
  if (!uid || !chatId) return;

  const sub = await st.getSub(uid);
  const emDia = sub && (sub.status === 'active' || sub.status === 'grace') && sub.expiresAt > Date.now();

  if (emDia) {
    await tg.approveChatJoinRequest(token, chatId, uid);
    return;
  }
  await tg.declineChatJoinRequest(token, chatId, uid);
  await tg.sendMessage(token, uid, 'Não achei uma assinatura ativa nesse seu perfil 🤔\n\nSe você já pagou, manda /acesso que eu verifico.');
}

/** Registra quando a pessoa de fato entrou ou saiu do grupo. */
async function aoMudarMembro(upd) {
  const uid = String(upd.new_chat_member && upd.new_chat_member.user && upd.new_chat_member.user.id);
  const status = upd.new_chat_member && upd.new_chat_member.status;
  if (!uid || !status) return;

  const sub = await st.getSub(uid);
  if (!sub) return;

  if (status === 'member' && !sub.joinedAt) {
    sub.joinedAt = Date.now();
    await st.saveSub(sub, sub.expDay);
  } else if (status === 'left') {
    sub.leftAt = Date.now();
    await st.saveSub(sub, sub.expDay);
  }
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
  const from = msg.from || {};
  if (!from.id || from.is_bot) return;

  // Em grupo/canal o bot só atende o dono, para o vínculo do grupo.
  if (chat.type !== 'private') {
    if (String(from.id) === cfg.donoId()) await comandoDeGrupo(token, msg, chat);
    return;
  }

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
  } else if (/^\/acesso\b/.test(texto)) {
    await comandoAcesso(token, u);
  } else if (/^\/status\b/.test(texto)) {
    await comandoStatus(token, u);
  } else if (u.ageOkAt) {
    // Já passou pelo gate: retoma de onde parou em vez de mandar recomeçar.
    await previews.enviarPrevia(token, u, u.step || 0);
  } else {
    await tg.sendMessage(token, u.chatId, 'Manda /start que eu te mostro o que separei 😏');
  }

  await st.saveUser(u);
}

/** Segunda via do convite, com limite diário para não virar torneira de links. */
async function comandoAcesso(token, u) {
  const sub = await st.getSub(u.uid);
  if (!sub || sub.status === 'removed') {
    await tg.sendMessage(token, u.chatId, 'Não achei uma assinatura ativa nesse seu perfil 🤔\n\nSe você comprou com outro Telegram, me diga o e-mail usado na compra que eu verifico.');
    return;
  }
  if (sub.expiresAt <= Date.now()) {
    await tg.sendMessage(token, u.chatId, 'Seu acesso venceu 😢 mas dá pra voltar agora mesmo:', {
      reply_markup: tg.teclado([[tg.botaoUrl('RENOVAR ➜', await previews.linkCta(u))]]),
    });
    return;
  }

  const hoje = st.diaDe(Date.now());
  if (u.reissueDay !== hoje) { u.reissueDay = hoje; u.reissues = 0; }
  if (u.reissues >= 3) {
    await tg.sendMessage(token, u.chatId, 'Já te mandei o link várias vezes hoje 🙈 tenta amanhã ou me chama no /suporte.');
    return;
  }
  u.reissues += 1;

  const chats2 = require('../bot/chats');
  const chatDoc = await chats2.getChat(sub.chatKey || 'vip');
  if (!chatDoc || !chatDoc.chatId) {
    await tg.sendMessage(token, u.chatId, 'Tive um problema aqui — já avisei a equipe, me chama no /suporte 🙏');
    return;
  }

  // Invalida o link anterior antes de emitir outro.
  if (sub.inviteLink) await tg.revokeChatInviteLink(token, chatDoc.chatId, sub.inviteLink);
  const params = { expire_date: Math.floor((Date.now() + 30 * 60 * 1000) / 1000), name: ('2via ' + u.uid).slice(0, 32) };
  if (chatDoc.joinMode === 'request') params.creates_join_request = true;
  else params.member_limit = 1;

  const r = await tg.createChatInviteLink(token, chatDoc.chatId, params);
  if (!r.ok) {
    await tg.sendMessage(token, u.chatId, 'Não consegui gerar o link agora 😞 tenta de novo em alguns minutos.');
    return;
  }
  sub.inviteLink = r.result.invite_link;
  sub.inviteExpiresAt = Date.now() + 30 * 60 * 1000;
  await st.saveSub(sub, sub.expDay);

  await tg.sendMessage(token, u.chatId, 'Aqui está 👇 vale por 30 minutos.', {
    reply_markup: tg.teclado([[tg.botaoUrl('ENTRAR NO VIP ➜', sub.inviteLink)]]),
  });
}

async function comandoStatus(token, u) {
  const sub = await st.getSub(u.uid);
  if (!sub || sub.status === 'removed') {
    await tg.sendMessage(token, u.chatId, 'Você ainda não tem VIP ativo por aqui 😌', {
      reply_markup: tg.teclado([[tg.botaoUrl('QUERO ENTRAR ➜', await previews.linkCta(u))]]),
    });
    return;
  }
  const venc = new Date(sub.expiresAt).toLocaleDateString('pt-BR');
  const dias = Math.ceil((sub.expiresAt - Date.now()) / st.DIA_MS);
  await tg.sendMessage(
    token, u.chatId,
    dias > 0
      ? `Seu VIP está ativo ✅\n\nPlano: <b>${tg.esc(sub.plan || '-')}</b>\nVence em <b>${venc}</b> (${dias} dia${dias === 1 ? '' : 's'})`
      : `Seu acesso venceu em <b>${venc}</b> 😢`
  );
}

async function comandoStart(token, u, payload) {
  // c_<claim>: resgate da compra de quem não passou pelo bot antes.
  const claim = payload.match(/^c_([A-Za-z0-9_-]{6,40})$/);
  if (claim) {
    const r = await access.resgatarClaim(u.uid, claim[1]);
    if (r.ok) { await st.saveUser(u); return; }
    await tg.sendMessage(token, u.chatId, r.erro === 'pedido_nao_pago'
      ? 'Esse pagamento ainda não consta como confirmado 🤔 assim que cair, é só apertar o botão de novo.'
      : 'Esse link de acesso não vale mais. Manda /acesso que eu verifico sua compra.');
    return;
  }

  // s_<origem> diz de onde a pessoa veio (s_ig, s_tiktok, s_x...).
  if (/^s_[a-z0-9_-]{1,20}$/i.test(payload)) u.src = payload.slice(2).toLowerCase();

  // Assinante ativo não volta pra sequência de prévias.
  const sub = await st.getSub(u.uid);
  if (sub && sub.status === 'active' && sub.expiresAt > Date.now()) {
    await comandoStatus(token, u);
    return;
  }

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
