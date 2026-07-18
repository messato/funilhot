// Publicar: recebe o vídeo (multipart) e manda pra agregadora. Não usa o adapter
// de evento (que serializa o body como texto) porque precisa do arquivo binário.
import store from '../../../../netlify/lib/store.js';
import adminauth from '../../../../netlify/lib/adminauth.js';
import social from '../../../../netlify/lib/social.js';
import socialHandler from '../../../../netlify/lib/handlers/social.js';

const H = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: H });

function bridgeEnv(env) {
  try {
    if (typeof process === 'undefined' || !process.env) return;
    for (const k in env) { if (typeof env[k] === 'string') process.env[k] = env[k]; }
  } catch { /* ignore */ }
}

export async function onRequest(context) {
  const { request, env } = context;
  bridgeEnv(env);
  store.useKV(env.funil);

  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!process.env.ADMIN_PASSWORD) return json(503, { ok: false, error: 'admin_not_configured' });
  if (!adminauth.verifyToken(request.headers.get('x-admin-key') || '')) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: 'invalid_form' }); }

  const file = form.get('video');
  const caption = (form.get('caption') || '').toString().slice(0, 2200);
  const networks = form.getAll('networks').map(String);
  const wantsKwai = networks.includes('kwai');
  const autoNets = networks.filter((n) => social.NETWORKS.includes(n));

  if (!autoNets.length && !wantsKwai) return json(400, { ok: false, error: 'sem_rede' });

  let fileBuffer = null; let fileName = ''; let contentType = '';
  if (file && typeof file.arrayBuffer === 'function') {
    if (file.size > 100 * 1024 * 1024) return json(413, { ok: false, error: 'file_too_large' });
    fileBuffer = await file.arrayBuffer();
    fileName = file.name || 'video.mp4';
    contentType = file.type || 'video/mp4';
  } else if (autoNets.length) {
    return json(400, { ok: false, error: 'sem_arquivo' });
  }

  let pub = { id: '', provider: 'none', results: [] };
  if (autoNets.length) {
    try {
      pub = await social.publish({ fileBuffer, fileName, contentType, caption, networks: autoNets });
    } catch (error) {
      console.error('publish failed:', error.message, error.detail);
      return json(502, { ok: false, error: 'publish_failed' });
    }
  }

  const rec = {
    id: pub.id || ('post-' + Math.random().toString(16).slice(2, 10)),
    createdAt: Date.now(),
    caption,
    fileName,
    networks: autoNets,
    results: pub.results || [],
    kwai: wantsKwai ? 'pending' : null,
    provider: pub.provider,
  };
  try { await socialHandler.savePost(rec); } catch (error) { console.error('save social failed:', error.message); }

  return json(200, { ok: true, post: rec });
}
