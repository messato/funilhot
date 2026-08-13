'use strict';

// Grupos e canais que o bot administra.
//
// O id numérico do grupo mora SÓ aqui, atrás de uma chave lógica (`vip`,
// `vip-plus`, `cofre`). Isso importa porque, quando um grupo comum vira
// supergrupo — o que costuma acontecer justamente ao promover o bot a admin —
// o chat_id muda. Com a indireção, a migração custa uma escrita; sem ela,
// exigiria reescrever todas as assinaturas.

const { getJSON, setJSON, listKeys, del } = require('../store');
const tg = require('../telegram');

const kChat = (chatKey) => `bot/chats/${chatKey}.json`;
const kPend = (chatId) => `bot/chats/pending/${chatId}.json`;

const ADMIN_TTL_MS = 12 * 3600 * 1000;

async function getChat(chatKey) {
  return await getJSON(kChat(chatKey));
}

async function saveChat(doc) {
  doc.updatedAt = Date.now();
  await setJSON(kChat(doc.chatKey), doc);
  return doc;
}

/** Resolve a chave lógica para o id numérico. null se ainda não vinculado. */
async function chatIdDe(chatKey) {
  const c = await getChat(chatKey);
  return c && c.chatId ? c.chatId : null;
}

async function listarVinculados() {
  const chaves = await listKeys('bot/chats/');
  const docs = await Promise.all(
    chaves.filter((k) => !k.includes('/pending/')).map((k) => getJSON(k))
  );
  return docs.filter(Boolean);
}

async function listarPendentes() {
  const chaves = await listKeys('bot/chats/pending/');
  const docs = await Promise.all(chaves.map((k) => getJSON(k)));
  return docs.filter(Boolean);
}

/**
 * Chega quando o bot é adicionado/promovido/removido de um grupo.
 * É o que dispensa o dono de copiar id numérico à mão: ele adiciona o bot,
 * promove a admin, e o grupo aparece no painel esperando o vínculo.
 */
async function aoMudarStatus(token, upd) {
  const chat = upd.chat || {};
  const novo = upd.new_chat_member || {};
  const status = novo.status || '';
  const chatId = chat.id;
  if (!chatId) return null;

  // Saiu ou foi rebaixado: marca, mas não apaga o vínculo — o dono pode estar
  // só reorganizando permissões, e apagar perderia a ligação com as assinaturas.
  if (status === 'left' || status === 'kicked') {
    const vinculado = (await listarVinculados()).find((c) => c.chatId === chatId);
    if (vinculado) {
      vinculado.botStatus = status;
      vinculado.canInvite = false;
      await saveChat(vinculado);
    }
    try { await del(kPend(chatId)); } catch { /* ok */ }
    return { acao: 'saiu', chatId };
  }

  const podeConvidar = status === 'creator' || (status === 'administrator' && novo.can_invite_users !== false);
  const podeRestringir = status === 'creator' || (status === 'administrator' && novo.can_restrict_members !== false);

  // Já vinculado? Só atualiza as permissões.
  const vinculado = (await listarVinculados()).find((c) => c.chatId === chatId);
  if (vinculado) {
    vinculado.botStatus = status;
    vinculado.canInvite = podeConvidar;
    vinculado.canRestrict = podeRestringir;
    vinculado.title = chat.title || vinculado.title;
    await saveChat(vinculado);
    return { acao: 'atualizado', chatKey: vinculado.chatKey, chatId };
  }

  const pend = {
    chatId,
    title: chat.title || '(sem título)',
    type: chat.type || '',
    botStatus: status,
    canInvite: podeConvidar,
    canRestrict: podeRestringir,
    descobertoEm: Date.now(),
  };
  await setJSON(kPend(chatId), pend);

  // Só vale avisar quando o bot já pode trabalhar.
  if (status === 'administrator' || status === 'creator') {
    const faltando = [];
    if (!podeConvidar) faltando.push('convidar usuários');
    if (!podeRestringir) faltando.push('remover membros');

    const texto = faltando.length
      ? `⚠️ Fui promovido aqui, mas ainda faltam permissões: <b>${faltando.join('</b> e <b>')}</b>.\n\n`
        + `Sem elas eu não consigo entregar nem retirar acesso. Ajuste em Editar administradores.`
      : `✅ Grupo registrado: <b>${tg.esc(pend.title)}</b>\n`
        + `<code>${chatId}</code>\n\n`
        + `Agora é só abrir o painel → aba <b>Bot</b> e dizer qual nível VIP este grupo atende.`;

    await tg.sendMessage(token, chatId, texto);
  }
  return { acao: 'pendente', chatId };
}

/** Vincula um grupo descoberto a uma chave lógica (feito pelo painel). */
async function vincular(chatKey, chatId, extras = {}) {
  const pend = await getJSON(kPend(chatId));
  const doc = {
    chatKey,
    chatId,
    title: extras.title || (pend && pend.title) || '',
    type: (pend && pend.type) || '',
    botStatus: (pend && pend.botStatus) || '',
    canInvite: pend ? pend.canInvite : true,
    canRestrict: pend ? pend.canRestrict : true,
    // 'request' exige aprovação e é o único modo que valida QUEM entra; um
    // convite de uso único limita o número de usos, não a pessoa.
    joinMode: extras.joinMode || 'invite',
    admins: [],
    adminsAt: 0,
    vinculadoEm: Date.now(),
  };
  await saveChat(doc);
  try { await del(kPend(chatId)); } catch { /* ok */ }
  return doc;
}

async function desvincular(chatKey) {
  try { await del(kChat(chatKey)); } catch { /* ok */ }
}

/**
 * Grupo comum virou supergrupo: o id muda e o antigo para de funcionar.
 * Uma escrita resolve, graças à chave lógica.
 */
async function aoMigrar(chatIdAntigo, chatIdNovo) {
  const vinculado = (await listarVinculados()).find((c) => c.chatId === chatIdAntigo);
  if (!vinculado) return null;
  vinculado.migratedFrom = chatIdAntigo;
  vinculado.chatId = chatIdNovo;
  vinculado.type = 'supergroup';
  await saveChat(vinculado);
  return vinculado;
}

/**
 * Administradores do grupo, em cache. Serve para nunca remover um admin na
 * rotina de expiração.
 */
async function admins(token, chatDoc) {
  const agora = Date.now();
  if (chatDoc.adminsAt && agora - chatDoc.adminsAt < ADMIN_TTL_MS && Array.isArray(chatDoc.admins)) {
    return chatDoc.admins;
  }
  const r = await tg.getChatAdministrators(token, chatDoc.chatId);
  if (!r.ok) return chatDoc.admins || [];
  const ids = (r.result || []).map((m) => String(m.user && m.user.id)).filter(Boolean);
  chatDoc.admins = ids;
  chatDoc.adminsAt = agora;
  await saveChat(chatDoc);
  return ids;
}

module.exports = {
  kChat, kPend,
  getChat, saveChat, chatIdDe, listarVinculados, listarPendentes,
  aoMudarStatus, vincular, desvincular, aoMigrar, admins,
};
