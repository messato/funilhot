'use strict';

// Tarefas agendadas do bot.
//
// Duas restrições moldam este arquivo:
//  - Orçamento de sub-requisições do Worker (50 no plano gratuito). Um trabalho
//    que manda 500 mensagens de uma vez estoura; por isso tudo é fatiado e o
//    que sobra fica para a próxima execução.
//  - Limite de envio do Telegram (~1 msg/s por chat). Por isso os envios saem
//    espaçados, e quem já foi avisado é marcado individualmente.

const st = require('../../netlify/lib/bot/state');
const access = require('../../netlify/lib/bot/access');
const cfg = require('../../netlify/lib/bot/config');
const tg = require('../../netlify/lib/telegram');
const { getSettings } = require('../../netlify/lib/settings');
const { getJSON, setJSON } = require('../../netlify/lib/store');

const DIA_MS = 24 * 3600 * 1000;
const LOTE_MAX = 120;   // teto por execução, para não estourar sub-requisições
const ESPACO_MS = 80;

/** Impede que duas execuções do mesmo trabalho se atropelem. */
async function comTrava(nome, fn) {
  const chave = `tmp/lock/${nome}-${st.diaDe(Date.now())}`;
  if (await getJSON(chave)) return { pulou: 'ja_rodou' };
  await setJSON(chave, { em: Date.now() }, { expirationTtl: 3600 });
  return await fn();
}

function aplicarVariaveis(texto, dados) {
  return String(texto || '').replace(/\{(\w+)\}/g, (_, k) => (dados[k] == null ? '' : dados[k]));
}

/* ---------- avisos de vencimento ---------- */

async function avisarVencimentos(token, s) {
  const hoje = Date.now();
  const alvos = [];

  for (const [dias, marca] of [[3, 'd3'], [1, 'd1']]) {
    const dia = st.diaDe(hoje + dias * DIA_MS);
    for (const hint of await st.listarExpiracoes(dia)) {
      // O índice é palpite: a verdade está no documento.
      const sub = await st.getSub(hint.uid);
      if (!sub || sub.status !== 'active') continue;
      if (sub.warned && sub.warned[marca]) continue;
      alvos.push({ sub, marca, dias });
    }
  }

  const r = await tg.enviarEmLote(alvos, async ({ sub, marca, dias }) => {
    const u = await st.getUser(sub.uid);
    if (u && u.blocked) return { pulado: true };

    const texto = aplicarVariaveis(
      s.expiringMsg || 'Oi {nome}! Seu acesso VIP vence em {dias} dia(s).',
      { nome: (u && u.first) || '', dias }
    );
    const env = await tg.sendMessage(token, (u && u.chatId) || sub.uid, texto, {
      reply_markup: tg.teclado([[tg.botaoUrl('RENOVAR ➜', cfg.baseUrl() + '/?utm_source=telegram&utm_medium=bot&utm_campaign=renovacao')]]),
    });
    // Erro terminal = pessoa bloqueou o bot; marcar evita gastar requisição
    // com ela em toda execução futura.
    if (!env.ok && env.terminal) { await st.marcarBloqueado(sub.uid); return { bloqueado: true }; }

    sub.warned = { ...(sub.warned || {}), [marca]: Date.now() };
    await st.saveSub(sub, sub.expDay);
    await st.evento('bot_warn', { uid: sub.uid, marca });
    return { ok: true };
  }, { espacoMs: ESPACO_MS, maximo: LOTE_MAX });

  return { avisados: r.processados, restantes: r.restantes };
}

/* ---------- remoção de quem venceu ---------- */

async function removerVencidos(token, s) {
  const graceDays = Math.max(0, Number(s.graceDays == null ? 1 : s.graceDays));
  const hoje = Date.now();
  // Carência de pelo menos um dia: absorve a janela de consistência eventual
  // do KV, que releitura sozinha não resolve.
  const diaAlvo = st.diaDe(hoje - graceDays * DIA_MS);

  const hints = await st.listarExpiracoes(diaAlvo);
  const r = await tg.enviarEmLote(hints, async (hint) => {
    const res = await access.revogarAcesso({ uid: hint.uid, motivo: 'venceu' });
    if (!res.ok || res.jaResolvido || res.renovou || res.isento) return res;

    const u = await st.getUser(hint.uid);
    if (u && !u.blocked) {
      await tg.sendMessage(token, u.chatId || hint.uid,
        'Seu acesso VIP chegou ao fim 💔\n\nQuando quiser voltar, é só clicar aqui:', {
          reply_markup: tg.teclado([[tg.botaoUrl('VOLTAR PRO VIP ➜', cfg.baseUrl() + '/?utm_source=telegram&utm_medium=bot&utm_campaign=winback')]]),
        });
    }
    return res;
  }, { espacoMs: ESPACO_MS, maximo: LOTE_MAX });

  return { removidos: r.processados, restantes: r.restantes };
}

/* ---------- reconciliação semanal ---------- */

/**
 * Varre todas as assinaturas, corrige o status e reconstrói o índice.
 * Sem isso o índice por dia seria uma bomba-relógio: qualquer escrita perdida
 * viraria alguém que nunca vence ou nunca é avisado.
 */
async function reconciliar() {
  const subs = await st.listarAssinaturas();
  let corrigidas = 0;
  for (const sub of subs) {
    const antes = JSON.stringify([sub.status, sub.expDay]);
    if (sub.status === 'active' && sub.expiresAt <= Date.now()) sub.status = 'grace';
    await st.saveSub(sub, sub.expDay);
    if (JSON.stringify([sub.status, sub.expDay]) !== antes) corrigidas++;
  }
  return { assinaturas: subs.length, corrigidas };
}

/* ---------- resumo diário ---------- */

/**
 * Ressuscita o resumo que morreu na migração para a Cloudflare: ele usava
 * agendamento do Netlify, que não existe aqui.
 */
async function resumoDiario(token) {
  const dono = cfg.donoId() || process.env.TELEGRAM_CHAT_ID;
  if (!dono) return { pulou: 'sem_dono' };

  const metrics = require('../../netlify/lib/settings') && require('../../netlify/lib/metrics');
  const resumo = await metrics.summary(1);
  const k = resumo.kpis || {};
  const brl = (c) => 'R$ ' + ((c || 0) / 100).toFixed(2).replace('.', ',');

  const subs = await st.listarAssinaturas();
  const ativos = subs.filter((s) => s.status === 'active' && s.expiresAt > Date.now()).length;
  const vencendo = subs.filter((s) => s.expiresAt > Date.now() && s.expiresAt < Date.now() + 3 * DIA_MS).length;

  const texto = [
    '📊 <b>Resumo de hoje</b>',
    '',
    `💰 Receita: <b>${brl(k.gross)}</b>`,
    `🧾 Vendas: <b>${k.paidCount || 0}</b>`,
    `🔗 PIX gerados: <b>${k.pixCount || 0}</b>`,
    '',
    `👑 VIPs ativos: <b>${ativos}</b>`,
    vencendo ? `⏳ Vencendo em 3 dias: <b>${vencendo}</b>` : '',
  ].filter(Boolean).join('\n');

  await tg.sendMessage(token, dono, texto);
  return { ok: true, ativos };
}

/* ---------- despacho ---------- */

async function rodar(nome) {
  const token = await cfg.tokenAtivo();
  if (!token) return { erro: 'bot_nao_configurado' };
  const s = await getSettings();

  if (nome === 'manha') {
    return await comTrava('manha', async () => ({
      avisos: await avisarVencimentos(token, s),
      remocoes: await removerVencidos(token, s),
    }));
  }
  if (nome === 'resumo') return await comTrava('resumo', () => resumoDiario(token));
  if (nome === 'reconciliar') return await reconciliar();
  return { erro: 'trabalho_desconhecido' };
}

module.exports = { rodar, avisarVencimentos, removerVencidos, reconciliar, resumoDiario };
