'use strict';

// Adapter de agregadora de postagem multi-rede (abstraído, trocável — como o
// provider da AssetPay). Sem SOCIAL_API_KEY, roda em modo STUB (simula a
// publicação) para dev/demonstração.
//
// env:
//   SOCIAL_API_KEY  -> chave da agregadora escolhida (Upload-Post, Zernio, ...)
//   SOCIAL_API_URL  -> base da API (default abaixo)
//
// Kwai NÃO entra aqui: não tem API oficial de postagem, é sempre manual.

const NETWORKS = ['instagram', 'tiktok', 'youtube', 'facebook', 'x'];

function getConfig() {
  const key = process.env.SOCIAL_API_KEY || '';
  const base = (process.env.SOCIAL_API_URL || 'https://api.upload-post.com').replace(/\/+$/, '');
  return { key, base, enabled: Boolean(key) };
}

async function listAccounts() {
  const { key, base, enabled } = getConfig();
  if (!enabled) return { provider: 'stub', accounts: [] };
  try {
    const res = await fetch(base + '/api/uploadposts/users', { headers: { Authorization: 'Apikey ' + key } });
    const data = await res.json().catch(() => ({}));
    return { provider: 'aggregator', accounts: data.accounts || data.profiles || [] };
  } catch (error) {
    return { provider: 'aggregator', accounts: [], error: error.message };
  }
}

// Publica um vídeo nas redes automáticas. `fileBuffer` é um ArrayBuffer.
async function publish({ fileBuffer, fileName, contentType, caption, networks, scheduleAt }) {
  const { key, base, enabled } = getConfig();
  const nets = (networks || []).filter((n) => NETWORKS.includes(n));

  if (!enabled) {
    // Modo simulado: finge que publicou em todas as redes escolhidas.
    return {
      id: 'stub-' + Math.random().toString(16).slice(2, 10),
      provider: 'stub',
      results: nets.map((n) => ({ network: n, status: 'published', url: '' })),
    };
  }

  // Chamada real (formato multipart genérico — ajustar ao fornecedor final):
  const form = new FormData();
  form.append('video', new Blob([fileBuffer], { type: contentType || 'video/mp4' }), fileName || 'video.mp4');
  form.append('title', caption || '');
  nets.forEach((n) => form.append('platform[]', n));
  if (scheduleAt) form.append('scheduled_date', scheduleAt);

  const res = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Apikey ' + key },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error('social_publish_failed');
    err.status = res.status;
    err.detail = text.slice(0, 500);
    throw err;
  }
  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  const perNet = (data.results || data.platforms || {});
  return {
    id: String(data.id || data.request_id || ''),
    provider: 'aggregator',
    results: nets.map((n) => ({
      network: n,
      status: perNet[n] && (perNet[n].success || perNet[n].status === 'success') ? 'published' : 'processing',
      url: (perNet[n] && (perNet[n].url || perNet[n].post_url)) || '',
    })),
  };
}

module.exports = { NETWORKS, getConfig, listAccounts, publish };
