'use strict';

// Catálogo de prévias e a sequência liberada por clique.
//
// As mídias NÃO ficam no KV. Elas vivem num canal privado ("cofre") e são
// reenviadas com copyMessage. Dois motivos:
//  - file_id só vale para o bot que o recebeu; guardar file_id amarraria o
//    catálogo inteiro a um bot, e a contingência de trocar de bot morreria.
//  - copyMessage não marca "encaminhado" e aceita protect_content.

const { getJSON, setJSON } = require('../store');
const tg = require('../telegram');
const st = require('./state');
const chats = require('./chats');

const CHAVE = 'bot/previews/index.json';
const MAX_ITENS = 30;

async function getCatalogo() {
  const doc = await getJSON(CHAVE);
  if (doc && Array.isArray(doc.items)) return doc;
  return { v: 1, items: [], updatedAt: 0 };
}

async function saveCatalogo(cat) {
  cat.updatedAt = Date.now();
  cat.v = (cat.v || 1) + 1; // a versão invalida botões antigos já enviados
  await setJSON(CHAVE, cat);
  return cat;
}

/**
 * O dono manda uma mídia no privado do bot e ela entra no catálogo.
 * Evita ter que construir tela de upload: o Telegram já é o melhor uploader.
 */
async function adicionarDoDono(token, msg) {
  const cofreId = await chats.chatIdDe('cofre');
  if (!cofreId) {
    return { ok: false, erro: 'Cadastre o canal cofre primeiro: me adicione nele como admin e vincule no painel (aba Bot).' };
  }

  let kind = '';
  if (msg.video) kind = 'video';
  else if (msg.photo) kind = 'photo';
  else if (msg.animation) kind = 'animation';
  else return { ok: false, erro: 'Me manda uma foto, vídeo ou GIF.' };

  // Copia para o cofre: é de lá que as prévias serão reenviadas depois.
  const copia = await tg.copyMessage(token, cofreId, msg.chat.id, msg.message_id);
  if (!copia.ok) return { ok: false, erro: 'Não consegui salvar no cofre: ' + copia.error };

  const cat = await getCatalogo();
  if (cat.items.length >= MAX_ITENS) return { ok: false, erro: `Limite de ${MAX_ITENS} prévias atingido.` };

  const item = {
    id: 'p' + Date.now().toString(36),
    kind,
    vaultChatId: cofreId,
    vaultMsgId: copia.result.message_id,
    caption: String(msg.caption || '').slice(0, 900),
    spoiler: true,
    protect: true,
  };
  cat.items.push(item);
  await saveCatalogo(cat);
  return { ok: true, item, total: cat.items.length };
}

async function removerItem(id) {
  const cat = await getCatalogo();
  const antes = cat.items.length;
  cat.items = cat.items.filter((i) => i.id !== id);
  if (cat.items.length !== antes) await saveCatalogo(cat);
  return cat;
}

async function reordenar(ids) {
  const cat = await getCatalogo();
  const mapa = new Map(cat.items.map((i) => [i.id, i]));
  const novos = ids.map((id) => mapa.get(id)).filter(Boolean);
  for (const i of cat.items) if (!ids.includes(i.id)) novos.push(i);
  cat.items = novos;
  await saveCatalogo(cat);
  return cat;
}

async function editarLegenda(id, caption) {
  const cat = await getCatalogo();
  const item = cat.items.find((i) => i.id === id);
  if (!item) return null;
  item.caption = String(caption || '').slice(0, 900);
  await saveCatalogo(cat);
  return item;
}

/* ---------- envio da sequência ---------- */

/** URL da LP com atribuição: o utm faz o evento cair no relatório existente. */
async function linkCta(u) {
  const cfg = require('./config');
  const tok = await st.garantirToken(u);
  const base = cfg.baseUrl();
  return `${base}/?utm_source=telegram&utm_medium=bot&utm_campaign=previas&tg=${tok}`;
}

function rotuloProximo(idx, total) {
  const rotulos = ['ver mais 🔥', 'quero o resto 😏', 'mais uma 🙈', 'continua 👀'];
  return idx + 1 >= total ? null : rotulos[idx % rotulos.length];
}

/**
 * Envia a prévia de índice `idx`. O CTA vai junto desde a primeira: forçar a
 * pessoa até o fim só faz perder quem já estava pronta para comprar.
 */
async function enviarPrevia(token, u, idx) {
  const cat = await getCatalogo();
  const total = cat.items.length;
  if (!total) {
    await tg.sendMessage(token, u.chatId, 'Ainda estou preparando as prévias 🙈 volta daqui a pouco!');
    return { ok: false, motivo: 'catalogo_vazio' };
  }
  if (idx >= total) return enviarFinal(token, u, cat);

  const item = cat.items[idx];
  const cta = await linkCta(u);
  const proximo = rotuloProximo(idx, total);

  const linhas = [];
  if (proximo) linhas.push([tg.botao(proximo, `p:${idx + 1}:${cat.v}`)]);
  linhas.push([tg.botaoUrl(idx + 1 >= total ? 'VER TUDO ➜' : 'quero tudo agora ➜', cta)]);

  const r = await tg.copyMessage(token, u.chatId, item.vaultChatId, item.vaultMsgId, {
    caption: item.caption || undefined,
    parse_mode: item.caption ? 'HTML' : undefined,
    protect_content: item.protect !== false,
    show_caption_above_media: false,
    reply_markup: tg.teclado(linhas),
  });

  if (!r.ok) {
    if (r.terminal) await st.marcarBloqueado(u.uid);
    return { ok: false, motivo: r.error };
  }

  u.step = Math.max(u.step || 0, idx + 1);
  u.state = 'previewing';
  await st.evento('bot_preview', { uid: u.uid, idx });
  return { ok: true, ultima: idx + 1 >= total };
}

/** Fecho da sequência, quando acabaram as prévias. */
async function enviarFinal(token, u, cat) {
  const cta = await linkCta(u);
  u.state = 'cta';
  await st.evento('bot_cta_view', { uid: u.uid });
  await tg.sendMessage(
    token, u.chatId,
    'Aqui eu tenho que parar 🙈\n\nO resto não cabe no Telegram público — tá tudo no VIP, sem corte.',
    { reply_markup: tg.teclado([[tg.botaoUrl('VER TUDO ➜', cta)]]) }
  );
  return { ok: true, final: true };
}

module.exports = {
  CHAVE, MAX_ITENS,
  getCatalogo, saveCatalogo, adicionarDoDono, removerItem, reordenar, editarLegenda,
  enviarPrevia, enviarFinal, linkCta,
};
