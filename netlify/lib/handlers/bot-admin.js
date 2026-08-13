'use strict';

// API do painel para a aba Bot. Segue o molde de handlers/social.js: mesmos
// guardas de autenticação, mesmo formato de resposta, roteamento pelo primeiro
// segmento depois de /bot.

const { verifyToken, headerKey } = require('../adminauth');
const { rateLimit, clientIp } = require('../ratelimit');
const cfg = require('../bot/config');
const st = require('../bot/state');
const chats = require('../bot/chats');
const previews = require('../bot/previews');
const tg = require('../telegram');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, payload) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) });

const CHAVES = ['vip', 'vip-plus', 'cofre'];

function corpo(event) {
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
}

/** Situação geral: o que já está configurado e o que falta. */
async function panorama() {
  const token = await cfg.tokenAtivo();
  const papel = await cfg.papelAtivo();

  let bot = null;
  if (token) {
    const me = await tg.getMe(token);
    if (me.ok) bot = { id: me.result.id, username: me.result.username, nome: me.result.first_name };
    const wh = await tg.getWebhookInfo(token);
    if (wh.ok) {
      bot = bot || {};
      bot.webhookOk = Boolean(wh.result.url);
      bot.pendentes = wh.result.pending_update_count || 0;
      bot.ultimoErro = wh.result.last_error_message || '';
    }
  }

  const vinculados = await chats.listarVinculados();
  const pendentes = await chats.listarPendentes();
  const cat = await previews.getCatalogo();

  const subs = await st.listarAssinaturas();
  const agora = Date.now();
  const DIA = 24 * 3600 * 1000;

  return {
    configurado: cfg.configurado(),
    papel,
    bot,
    chats: CHAVES.map((k) => {
      const c = vinculados.find((v) => v.chatKey === k);
      return c ? { chave: k, chatId: c.chatId, titulo: c.title, modo: c.joinMode, ok: true }
        : { chave: k, ok: false };
    }),
    pendentes: pendentes.map((p) => ({ chatId: p.chatId, titulo: p.title, tipo: p.type })),
    previas: cat.items.length,
    assinantes: {
      ativos: subs.filter((s) => s.status === 'active' && s.expiresAt > agora).length,
      vencendo: subs.filter((s) => s.expiresAt > agora && s.expiresAt < agora + 3 * DIA).length,
      semConvite: subs.filter((s) => s.status === 'pending_invite').length,
      removidos: subs.filter((s) => s.status === 'removed').length,
    },
  };
}

/** Funil das prévias: em qual passo as pessoas param de clicar. */
async function funilPrevias(dias) {
  const { listKeys, getJSON, dayKey } = require('../store');
  const DIA = 24 * 3600 * 1000;
  const cat = await previews.getCatalogo();
  const passos = new Array(Math.max(cat.items.length, 1)).fill(0);
  let starts = 0, idades = 0, ctas = 0, grants = 0;

  for (let i = 0; i < dias; i++) {
    const dia = dayKey(Date.now() - i * DIA);
    const chaves = await listKeys(`bev/${dia}/`);
    const evs = await Promise.all(chaves.map((k) => getJSON(k)));
    for (const e of evs) {
      if (!e) continue;
      if (e.e === 'bot_start') starts++;
      else if (e.e === 'bot_age_ok') idades++;
      else if (e.e === 'bot_preview' && typeof e.idx === 'number' && e.idx < passos.length) passos[e.idx]++;
      else if (e.e === 'bot_cta_view') ctas++;
      else if (e.e === 'bot_grant') grants++;
    }
  }
  return { starts, idades, passos, ctas, grants };
}

exports.handler = async function (event) {
  if (!process.env.ADMIN_PASSWORD) return reply(503, { ok: false, error: 'admin_not_configured' });
  if (!rateLimit('bot:' + clientIp(event), { limit: 120, windowMs: 60000 }).ok) {
    return reply(429, { ok: false, error: 'rate_limited' });
  }
  if (!verifyToken(headerKey(event))) return reply(401, { ok: false, error: 'unauthorized' });

  const m = (event.path || '').match(/\/bot\/?([^/?]*)/);
  const rota = m ? m[1] : '';
  const q = event.queryStringParameters || {};
  const post = event.httpMethod === 'POST';

  try {
    if (rota === 'panorama') return reply(200, { ok: true, ...(await panorama()) });

    if (rota === 'funil') {
      const dias = Math.min(90, Math.max(1, parseInt(q.days, 10) || 7));
      return reply(200, { ok: true, ...(await funilPrevias(dias)) });
    }

    if (rota === 'previas') {
      if (post) {
        const b = corpo(event);
        if (b.acao === 'remover' && b.id) return reply(200, { ok: true, cat: await previews.removerItem(b.id) });
        if (b.acao === 'legenda' && b.id) return reply(200, { ok: true, item: await previews.editarLegenda(b.id, b.caption) });
        if (b.acao === 'ordem' && Array.isArray(b.ids)) return reply(200, { ok: true, cat: await previews.reordenar(b.ids) });
        return reply(400, { ok: false, error: 'acao_invalida' });
      }
      const cat = await previews.getCatalogo();
      return reply(200, { ok: true, v: cat.v, items: cat.items });
    }

    if (rota === 'vincular' && post) {
      const b = corpo(event);
      const chave = String(b.chave || '');
      const chatId = parseInt(b.chatId, 10);
      if (!CHAVES.includes(chave) || !chatId) return reply(400, { ok: false, error: 'dados_invalidos' });
      const doc = await chats.vincular(chave, chatId, {
        joinMode: chave === 'cofre' ? 'invite' : 'request',
      });
      return reply(200, { ok: true, chat: doc });
    }

    if (rota === 'assinantes') {
      const subs = await st.listarAssinaturas();
      subs.sort((a, b2) => (b2.expiresAt || 0) - (a.expiresAt || 0));
      return reply(200, {
        ok: true,
        subs: subs.slice(0, 300).map((s) => ({
          uid: s.uid, plan: s.plan, status: s.status,
          expiresAt: s.expiresAt, joinedAt: s.joinedAt || 0, chatKey: s.chatKey,
        })),
      });
    }

    // Troca para o bot reserva (contingência) — reaponta o webhook também.
    if (rota === 'trocar-bot' && post) {
      const b = corpo(event);
      const alvo = b.papel === 'reserva' ? 'reserva' : 'principal';
      await cfg.trocarPara(alvo, b.motivo || 'troca manual pelo painel');
      const token = await cfg.tokenAtivo();
      const base = cfg.baseUrl();
      const url = `${base}/api/tg/${cfg.caminhoWebhook()}`;
      const r = await tg.setWebhook(token, url, cfg.segredoWebhook());
      return reply(200, { ok: r.ok, papel: alvo, webhook: r.ok ? 'registrado' : r.error });
    }

    return reply(404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('bot-admin erro:', error && error.message);
    return reply(500, { ok: false, error: 'internal' });
  }
};
