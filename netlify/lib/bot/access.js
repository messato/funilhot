'use strict';

// Entrada e saída do grupo VIP.
//
// Este arquivo é o coração compartilhado: a MESMA função idempotente é chamada
// pelo webhook (quando a venda confirma) e pelo cron (quando o prazo vence).
// Ter dois caminhos diferentes para conceder/remover acesso seria a origem
// garantida de divergência entre painel e realidade.

const { getJSON, setJSON } = require('../store');
const { custKey } = require('../members');
const { getSettings } = require('../settings');
const tg = require('../telegram');
const cfg = require('./config');
const st = require('./state');
const chats = require('./chats');

const HORA_MS = 3600 * 1000;

/** Nível VIP (chave lógica do grupo) a partir do plano comprado. */
function chatKeyDoPlano(plan) {
  return plan === 'anual' ? 'vip-plus' : 'vip';
}

/**
 * Descobre quem comprou, em três tentativas.
 * A ordem importa: token é o caminho sem atrito; e-mail cobre renovação de
 * quem comprou direto do Instagram; o claim é o resgate manual.
 */
async function acharUid(order) {
  if (order.tgToken) {
    const uid = await st.uidPorToken(order.tgToken);
    if (uid) return { uid, via: 'token' };
  }
  const chave = custKey(order);
  if (chave) {
    const uid = await st.uidPorCliente(chave);
    if (uid) return { uid, via: 'cliente' };
  }
  return { uid: null, via: null };
}

/** Claim curto para o botão do obrigado.html. O payload de /start aceita 64 chars. */
async function gerarClaim(orderId) {
  const claim = st.tokenAleatorio(12);
  await setJSON(`tmp/claim/${claim}`, { orderId, criadoEm: Date.now() }, { expirationTtl: 30 * 24 * 3600 });
  return claim;
}

/**
 * Concede acesso: cria (ou reaproveita) o convite de uso único e entrega.
 * Idempotente por `bot/order/<txid>.deliveredAt` e por `sub.inviteLink` —
 * markPaid pode ser chamado pelo webhook e pelo polling do checkout ao mesmo
 * tempo, e clicar duas vezes em pagar não pode gerar dois convites.
 */
async function concederAcesso({ uid, order, motivo = 'compra' }) {
  const token = await cfg.tokenAtivo();
  if (!token) return { ok: false, erro: 'bot_nao_configurado' };

  const vinculo = (await st.getOrderLink(order.id)) || {};
  if (vinculo.deliveredAt && vinculo.uid === String(uid)) {
    return { ok: true, jaEntregue: true };
  }

  const chatKey = chatKeyDoPlano(order.plan);
  const chatDoc = await chats.getChat(chatKey);
  const s = await getSettings();

  let sub = (await st.getSub(uid)) || {
    uid: String(uid), chatId: String(uid), orderIds: [], status: 'pending_invite',
  };
  const diaAnterior = sub.expDay;

  // Empilha o prazo em cima do que ainda resta: quem renova adiantado não perde
  // os dias que já pagou.
  sub.expiresAt = st.novoVencimento(order.plan, sub.expiresAt);
  sub.plan = order.plan;
  sub.chatKey = chatKey;
  sub.orderId = order.id;
  sub.orderIds = Array.from(new Set([...(sub.orderIds || []), order.id]));
  sub.custKey = custKey(order) || sub.custKey || '';
  sub.paidAt = order.paidAt || Date.now();
  sub.warned = {};
  sub.status = 'active';

  // Sem grupo vinculado ainda: registra a assinatura e avisa o dono, mas não
  // deixa o cliente sem resposta.
  if (!chatDoc || !chatDoc.chatId) {
    sub.status = 'pending_invite';
    sub.lastError = 'grupo_nao_vinculado';
    await st.saveSub(sub, diaAnterior);
    await avisarDono(token, `⚠️ Venda confirmada (${order.id}) mas o grupo "${chatKey}" não está vinculado no painel. O cliente ficou sem convite.`);
    await entregarFallback(token, uid, s);
    return { ok: false, erro: 'grupo_nao_vinculado' };
  }

  // Reaproveita convite ainda válido; senão cria um novo.
  let link = sub.inviteLink;
  if (!link || !sub.inviteExpiresAt || sub.inviteExpiresAt < Date.now()) {
    const expira = Math.floor((Date.now() + 24 * HORA_MS) / 1000);
    const params = { expire_date: expira, name: ('ord ' + String(order.id)).slice(0, 32) };
    // 'request' é o único modo que valida QUEM entra: um convite de uso único
    // limita o número de usos, não a pessoa — link repassado deixaria um
    // terceiro entrar no lugar do comprador.
    if (chatDoc.joinMode === 'request') params.creates_join_request = true;
    else params.member_limit = 1;

    const r = await tg.createChatInviteLink(token, chatDoc.chatId, params);
    if (!r.ok) {
      sub.status = 'pending_invite';
      sub.lastError = r.error;
      await st.saveSub(sub, diaAnterior);
      await avisarDono(token, `⚠️ Não consegui criar o convite do grupo "${chatKey}": ${r.error}. Confira se ainda sou admin com permissão de convidar.`);
      await entregarFallback(token, uid, s);
      return { ok: false, erro: r.error };
    }
    link = r.result.invite_link;
    sub.inviteLink = link;
    sub.inviteCreatedAt = Date.now();
    sub.inviteExpiresAt = Date.now() + 24 * HORA_MS;
  }

  await st.saveSub(sub, diaAnterior);
  await st.saveOrderLink(order.id, { uid: String(uid), deliveredAt: Date.now(), via: motivo });
  if (sub.custKey) {
    await st.vincularCliente(sub.custKey, uid, { orderIds: sub.orderIds, lastPaidAt: sub.paidAt, plan: sub.plan });
  }

  const u = await st.getUser(uid);
  if (u) { u.state = 'subscriber'; await st.saveUser(u); }

  const venc = new Date(sub.expiresAt).toLocaleDateString('pt-BR');
  await tg.sendMessage(
    token, (u && u.chatId) || uid,
    `Bem-vindo(a) pro VIP 🔥\n\nSeu acesso tá aqui — o link é só seu e vale por 24h.\nVálido até <b>${venc}</b>.`,
    { reply_markup: tg.teclado([[tg.botaoUrl('ENTRAR NO VIP ➜', link)]]) }
  );

  await st.evento('bot_grant', { uid: String(uid), plan: order.plan, via: motivo });
  return { ok: true, link, expiresAt: sub.expiresAt };
}

/** Último recurso: o link estático do painel, para o cliente não ficar a ver navios. */
async function entregarFallback(token, uid, s) {
  const link = s && s.vipLink;
  if (!link || /LINK_DO_GRUPO_VIP/.test(link)) return;
  await tg.sendMessage(token, uid, 'Tive um probleminha pra gerar seu convite. Use este link e, se não funcionar, me chama:', {
    reply_markup: tg.teclado([[tg.botaoUrl('ENTRAR NO VIP ➜', link)]]),
  });
}

async function avisarDono(token, texto) {
  const dono = cfg.donoId() || process.env.TELEGRAM_CHAT_ID;
  if (!dono) return;
  await tg.sendMessage(token, dono, texto);
}

/**
 * Remove do grupo. Idempotente e defensiva: relê a assinatura (o índice de
 * expiração é só palpite) e nunca remove admin.
 */
async function revogarAcesso({ uid, motivo = 'venceu' }) {
  const token = await cfg.tokenAtivo();
  if (!token) return { ok: false, erro: 'bot_nao_configurado' };

  const sub = await st.getSub(uid);
  if (!sub) return { ok: false, erro: 'sem_assinatura' };
  if (sub.status === 'removed' || sub.status === 'exempt') return { ok: true, jaResolvido: true };

  // Renovou entre a montagem do índice e agora.
  if (sub.expiresAt > Date.now()) return { ok: true, renovou: true };

  const chatDoc = await chats.getChat(sub.chatKey || 'vip');
  if (!chatDoc || !chatDoc.chatId) return { ok: false, erro: 'grupo_nao_vinculado' };

  // Nunca remover o dono nem administradores.
  const listaAdmins = await chats.admins(token, chatDoc);
  if (String(uid) === cfg.donoId() || listaAdmins.includes(String(uid))) {
    sub.status = 'exempt';
    await st.saveSub(sub, sub.expDay);
    return { ok: true, isento: true };
  }

  const r = await tg.removeMember(token, chatDoc.chatId, uid);
  if (!r.ok && r.owner) {
    // A API recusa remover o criador do grupo; tratar como resolvido, senão o
    // cron tenta a mesma pessoa todo dia para sempre.
    sub.status = 'exempt';
    await st.saveSub(sub, sub.expDay);
    return { ok: true, isento: true };
  }
  if (!r.ok) {
    sub.removeAttempts = (sub.removeAttempts || 0) + 1;
    sub.lastError = r.error;
    await st.saveSub(sub, sub.expDay);
    return { ok: false, erro: r.error };
  }

  const diaAnterior = sub.expDay;
  sub.status = 'removed';
  sub.removedAt = Date.now();
  sub.inviteLink = '';
  await st.saveSub(sub, diaAnterior);

  const u = await st.getUser(uid);
  if (u) { u.state = 'expired'; await st.saveUser(u); }
  await st.evento('bot_removed', { uid: String(uid), motivo });
  return { ok: true, unbanned: r.unbanned };
}

/**
 * Chamado por markPaid depois de confirmar o pagamento.
 * Nunca lança: uma falha aqui não pode derrubar a venda.
 */
async function aoPagarPedido(order) {
  try {
    const { uid, via } = await acharUid(order);
    if (uid) return await concederAcesso({ uid, order, motivo: via });

    // Ninguém identificado: gera o claim para o botão do obrigado.html.
    const claim = await gerarClaim(order.id);
    await st.saveOrderLink(order.id, { claim, criadoEm: Date.now() });
    return { ok: true, aguardandoResgate: true, claim };
  } catch (error) {
    console.error('aoPagarPedido:', error && error.message);
    return { ok: false, erro: 'interno' };
  }
}

/** Resgate pelo deep link: /start c_<claim>. */
async function resgatarClaim(uid, claim) {
  const doc = await getJSON(`tmp/claim/${claim}`);
  if (!doc || !doc.orderId) return { ok: false, erro: 'claim_invalido' };

  const { findOrder } = require('../orders');
  const achado = await findOrder(doc.orderId);
  if (!achado || achado.order.status !== 'paid') return { ok: false, erro: 'pedido_nao_pago' };

  return await concederAcesso({ uid, order: achado.order, motivo: 'claim' });
}

module.exports = {
  chatKeyDoPlano, acharUid, gerarClaim,
  concederAcesso, revogarAcesso, aoPagarPedido, resgatarClaim, avisarDono,
};
