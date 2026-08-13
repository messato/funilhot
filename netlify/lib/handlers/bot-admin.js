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

/**
 * Consolida os eventos de UM dia.
 * `passos` é objeto e não lista: o gráfico é dimensionado pela quantidade atual
 * de prévias, então uma lista de tamanho fixo desalinharia tudo silenciosamente
 * no dia em que uma prévia fosse acrescentada ou removida.
 */
async function agregarDia(dia) {
  const { listKeys, getJSON } = require('../store');
  const agg = { v: 1, dia, starts: 0, idades: 0, ctas: 0, grants: 0, passos: {}, origens: {} };

  const chaves = await listKeys(`bev/${dia}/`);
  const evs = await Promise.all(chaves.map((k) => getJSON(k)));
  for (const e of evs) {
    if (!e) continue;
    if (e.e === 'bot_start') {
      agg.starts++;
      // A origem já era gravada em todo /start e nunca era lida.
      const src = e.src || '(direto)';
      agg.origens[src] = (agg.origens[src] || 0) + 1;
    } else if (e.e === 'bot_age_ok') agg.idades++;
    else if (e.e === 'bot_preview' && typeof e.idx === 'number') {
      agg.passos[e.idx] = (agg.passos[e.idx] || 0) + 1;
    } else if (e.e === 'bot_cta_view') agg.ctas++;
    else if (e.e === 'bot_grant') agg.grants++;
  }
  return agg;
}

/**
 * Dia fechado vem do resumo gravado; se ainda não existir, calcula e grava.
 * O dia corrente é sempre ao vivo — nunca cacheado.
 * Mesmo desenho que o site já usa para o funil de vendas.
 */
async function diaAgg(dia) {
  const { getJSON, setJSON, dayKey } = require('../store');
  const hoje = dayKey();
  if (dia !== hoje) {
    const salvo = await getJSON(`rollup/bot/${dia}.json`);
    if (salvo && salvo.v === 1) return salvo;
  }
  const agg = await agregarDia(dia);
  if (dia !== hoje) await setJSON(`rollup/bot/${dia}.json`, agg);
  return agg;
}

/** Funil das prévias: em qual passo as pessoas param de clicar. */
async function funilPrevias(dias) {
  const { dayKey } = require('../store');
  const DIA = 24 * 3600 * 1000;
  const cat = await previews.getCatalogo();
  const total = Math.max(cat.items.length, 1);

  const passos = new Array(total).fill(0);
  const origens = {};
  let starts = 0, idades = 0, ctas = 0, grants = 0;

  for (let i = 0; i < dias; i++) {
    const agg = await diaAgg(dayKey(Date.now() - i * DIA));
    starts += agg.starts; idades += agg.idades; ctas += agg.ctas; grants += agg.grants;
    for (const [idx, n] of Object.entries(agg.passos || {})) {
      if (Number(idx) < total) passos[Number(idx)] += n;
    }
    for (const [src, n] of Object.entries(agg.origens || {})) {
      origens[src] = (origens[src] || 0) + n;
    }
  }
  return { starts, idades, passos, ctas, grants, origens };
}

/**
 * Consolida os dias já fechados. Chamado pelo agendador, para o painel nunca
 * pagar a varredura. Nunca consolida o dia corrente, e não consolida ontem
 * cedo demais: a listagem do banco é eventualmente consistente e escritas do
 * fim da noite podem ainda não ter aparecido.
 */
async function consolidarDias() {
  const { getJSON, setJSON, dayKey } = require('../store');
  const DIA = 24 * 3600 * 1000;
  const feitos = [];
  for (const atras of [1, 2]) {
    const dia = dayKey(Date.now() - atras * DIA);
    const salvo = await getJSON(`rollup/bot/${dia}.json`);
    if (salvo && salvo.v === 1) continue;
    await setJSON(`rollup/bot/${dia}.json`, await agregarDia(dia));
    feitos.push(dia);
  }
  return { consolidados: feitos };
}

exports.consolidarDias = consolidarDias;

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
        if (b.acao === 'legenda' && b.id) {
          const r = await previews.editarLegenda(b.id, b.caption);
          // Devolve o motivo para o painel mostrar o que consertar, em vez de
          // gravar um texto que faria a prévia não chegar ao lead.
          return r.ok ? reply(200, { ok: true, item: r.item }) : reply(400, { ok: false, error: r.erro });
        }
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
