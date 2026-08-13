// Worker agendado do bot.
//
// Mora fora do site porque Pages Functions não executam cron. Compartilha o
// mesmo namespace KV, então enxerga exatamente os mesmos dados do painel.

import store from '../../netlify/lib/store.js';
import jobs from './jobs.js';

// Os handlers leem configuração via process.env; o mesmo truque do adaptador
// das Pages Functions.
function bridgeEnv(env) {
  try {
    if (typeof process === 'undefined' || !process.env) return;
    for (const k in env) { if (typeof env[k] === 'string') process.env[k] = env[k]; }
  } catch { /* ignore */ }
}

// Mapeia cada horário do wrangler.toml para o trabalho correspondente.
const POR_CRON = {
  '0 12 * * *': 'manha',        // 09h BRT — avisos e remoções
  '0 0 * * *': 'resumo',        // 21h BRT — resumo diário
  '0 13 * * SUN': 'reconciliar', // domingo 10h BRT — reconstrói o índice
};

export default {
  async scheduled(event, env, ctx) {
    bridgeEnv(env);
    store.useKV(env.funil);
    const nome = POR_CRON[event.cron] || 'manha';
    ctx.waitUntil(
      jobs.rodar(nome)
        .then((r) => console.log('cron', nome, JSON.stringify(r)))
        .catch((e) => console.error('cron', nome, e && e.message))
    );
  },

  // Disparo manual protegido, para testar sem esperar o horário:
  //   curl "https://<worker>/run?job=manha&secret=<TELEGRAM_WEBHOOK_SECRET>"
  async fetch(request, env) {
    bridgeEnv(env);
    store.useKV(env.funil);

    const url = new URL(request.url);
    if (url.pathname !== '/run') return new Response('ok');

    const segredo = env.TELEGRAM_WEBHOOK_SECRET || '';
    if (!segredo || url.searchParams.get('secret') !== segredo) {
      return new Response('não autorizado', { status: 401 });
    }

    const nome = url.searchParams.get('job') || 'manha';
    const r = await jobs.rodar(nome);
    return new Response(JSON.stringify(r, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
