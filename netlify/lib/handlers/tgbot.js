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
const copy = require('../bot/copy');
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
  if (upd.channel_post) {
    // Canal não tem autor no post: quem manda é o próprio canal. A verificação
    // de dono é feita perguntando ao Telegram se o dono é admin de lá.
    await comandoDeGrupo(token, upd.channel_post, upd.channel_post.chat || {}, { semAutor: true });
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
async function comandoDeGrupo(token, msg, chat, opts = {}) {
  const texto = String(msg.text || msg.caption || '').trim();
  if (!/^\//.test(texto)) return;

  // Em canal o post não tem autor, então confirmamos a autoria perguntando ao
  // Telegram se o dono configurado é administrador de lá.
  if (opts.semAutor) {
    const dono = cfg.donoId();
    if (!dono) return;
    const r = await tg.getChatMember(token, chat.id, dono);
    const st2 = r.ok ? r.result.status : '';
    if (st2 !== 'administrator' && st2 !== 'creator') return;
  }

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
  await tg.sendMessage(token, uid, await copy.txt('entrada.negada'));
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
    await tg.sendMessage(token, chatId, await copy.txt('age.negado'));
  } else if (dados === 'age:ok') {
    u.ageOkAt = Date.now();
    u.state = 'previewing';
    await st.evento('bot_age_ok', { uid: u.uid });
    await tg.sendMessage(token, chatId, await copy.txt('age.ok'));
    await previews.enviarPrevia(token, u, 0);
  } else {
    const m = dados.match(/^p:(\d+):(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      const versao = parseInt(m[2], 10);
      const cat = await previews.getCatalogo();
      // Catálogo mudou depois que o botão foi enviado: os índices não valem mais.
      if (versao !== cat.v) {
        await tg.sendMessage(token, chatId, await copy.txt('previas.catalogo_mudou'));
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
    await tg.sendMessage(token, u.chatId, await copy.txt('suporte.resposta'));
  } else if (dono && String(from.id) === dono && /^\/(grupos|vincular)\b/.test(texto)) {
    await comandoDonoNoPrivado(token, u, texto);
  } else if (/^\/acesso\b/.test(texto)) {
    await comandoAcesso(token, u);
  } else if (/^\/status\b/.test(texto)) {
    await comandoStatus(token, u);
  } else if (u.ageOkAt) {
    // Já passou pelo gate: retoma de onde parou em vez de mandar recomeçar.
    await previews.enviarPrevia(token, u, u.step || 0);
  } else {
    await tg.sendMessage(token, u.chatId, await copy.txt('fallback.sem_start'));
  }

  await st.saveUser(u);
}

/**
 * Vínculo pelo privado — alternativa a mandar comando dentro do grupo/canal.
 *   /grupos                      lista o que já está vinculado e o que falta
 *   /vincular <chave> <id>       vincula direto pelo id numérico
 */
async function comandoDonoNoPrivado(token, u, texto) {
  const m = texto.match(/^\/vincular(?:@\w+)?\s+([a-z0-9-]+)\s+(-?\d+)/i);

  if (m) {
    const chave = m[1].toLowerCase();
    const chatId = parseInt(m[2], 10);
    if (!CHAVES[chave]) {
      await tg.sendMessage(token, u.chatId, `Não conheço "${tg.esc(chave)}". Opções: ${Object.keys(CHAVES).join(', ')}`);
      return;
    }
    const info = await tg.getChat(token, chatId);
    if (!info.ok) {
      await tg.sendMessage(token, u.chatId, `Não consegui ver esse chat: ${tg.esc(info.error)}\n\nMe adicione lá como administrador primeiro.`);
      return;
    }
    const doc = await chats.vincular(chave, chatId, {
      title: info.result.title,
      joinMode: chave === 'cofre' ? 'invite' : 'request',
    });
    await tg.sendMessage(token, u.chatId, `✅ <b>${tg.esc(doc.title || chatId)}</b> vinculado como <b>${chave}</b>.`);
    await st.evento('bot_chat_bind', { chave, chatId: String(chatId) });
    return;
  }

  const vinculados = await chats.listarVinculados();
  const pendentes = await chats.listarPendentes();
  const linhas = ['<b>Grupos e canais</b>', ''];

  for (const chave of Object.keys(CHAVES)) {
    const v = vinculados.find((c) => c.chatKey === chave);
    linhas.push(v
      ? `✅ <b>${chave}</b> — ${tg.esc(v.title || v.chatId)}`
      : `⬜ <b>${chave}</b> — ${CHAVES[chave]} <i>(falta vincular)</i>`);
  }
  if (pendentes.length) {
    linhas.push('', '<b>Detectados, aguardando vínculo:</b>');
    for (const p of pendentes) linhas.push(`• ${tg.esc(p.title)} — <code>${p.chatId}</code>`);
  }
  linhas.push('', 'Para vincular: <code>/vincular vip -100123456</code>');
  await tg.sendMessage(token, u.chatId, linhas.join('\n'));
}

/** Segunda via do convite, com limite diário para não virar torneira de links. */
async function comandoAcesso(token, u) {
  const sub = await st.getSub(u.uid);
  if (!sub || sub.status === 'removed') {
    await tg.sendMessage(token, u.chatId, await copy.txt('acesso.sem_assinatura'));
    return;
  }
  if (sub.expiresAt <= Date.now()) {
    await tg.sendMessage(token, u.chatId, await copy.txt('acesso.vencido'), {
      reply_markup: tg.teclado([[tg.botaoUrl(await copy.txt('btn.renovar'), await previews.linkCta(u))]]),
    });
    return;
  }

  const hoje = st.diaDe(Date.now());
  if (u.reissueDay !== hoje) { u.reissueDay = hoje; u.reissues = 0; }
  if (u.reissues >= 3) {
    await tg.sendMessage(token, u.chatId, await copy.txt('acesso.limite_diario'));
    return;
  }
  u.reissues += 1;

  const chats2 = require('../bot/chats');
  const chatDoc = await chats2.getChat(sub.chatKey || 'vip');
  if (!chatDoc || !chatDoc.chatId) {
    await tg.sendMessage(token, u.chatId, await copy.txt('acesso.erro_interno'));
    return;
  }

  // Invalida o link anterior antes de emitir outro.
  if (sub.inviteLink) await tg.revokeChatInviteLink(token, chatDoc.chatId, sub.inviteLink);
  const params = { expire_date: Math.floor((Date.now() + 30 * 60 * 1000) / 1000), name: ('2via ' + u.uid).slice(0, 32) };
  if (chatDoc.joinMode === 'request') params.creates_join_request = true;
  else params.member_limit = 1;

  const r = await tg.createChatInviteLink(token, chatDoc.chatId, params);
  if (!r.ok) {
    await tg.sendMessage(token, u.chatId, await copy.txt('acesso.erro_link'));
    return;
  }
  sub.inviteLink = r.result.invite_link;
  sub.inviteExpiresAt = Date.now() + 30 * 60 * 1000;
  await st.saveSub(sub, sub.expDay);

  await tg.sendMessage(token, u.chatId, await copy.txt('acesso.link_ok', { minutos: 30 }), {
    reply_markup: tg.teclado([[tg.botaoUrl(await copy.txt('btn.entrar_vip'), sub.inviteLink)]]),
  });
}

async function comandoStatus(token, u) {
  const sub = await st.getSub(u.uid);
  if (!sub || sub.status === 'removed') {
    await tg.sendMessage(token, u.chatId, await copy.txt('status.sem_vip'), {
      reply_markup: tg.teclado([[tg.botaoUrl(await copy.txt('btn.quero_entrar'), await previews.linkCta(u))]]),
    });
    return;
  }
  const venc = new Date(sub.expiresAt).toLocaleDateString('pt-BR');
  const dias = Math.ceil((sub.expiresAt - Date.now()) / st.DIA_MS);
  await tg.sendMessage(
    token, u.chatId,
    dias > 0
      ? await copy.txt('status.ativo', { plano: sub.plan || '-', venc, dias })
      : await copy.txt('status.vencido', { venc })
  );
}

async function comandoStart(token, u, payload) {
  // c_<claim>: resgate da compra de quem não passou pelo bot antes.
  const claim = payload.match(/^c_([A-Za-z0-9_-]{6,40})$/);
  if (claim) {
    const r = await access.resgatarClaim(u.uid, claim[1]);
    if (r.ok) { await st.saveUser(u); return; }
    await tg.sendMessage(token, u.chatId, await copy.txt(
      r.erro === 'pedido_nao_pago' ? 'claim.nao_pago' : 'claim.invalido'
    ));
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

  await tg.sendMessage(
    token,
    u.chatId,
    // O nome é escapado pelo próprio catálogo ao aplicar a variável.
    await copy.txt('start.saudacao', { nome: u.first ? ', ' + u.first : '' }),
    {
      reply_markup: tg.teclado([[
        tg.botao(await copy.txt('btn.age_sim'), 'age:ok'),
        tg.botao(await copy.txt('btn.age_nao'), 'age:no'),
      ]]),
    }
  );
}
