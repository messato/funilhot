// Upload de imagem da landing (avatar/capa/logo) → guarda no KV como binário
// e atualiza a versão nas settings (cache-buster). Protegido por token do admin.
import store from '../../../../netlify/lib/store.js';
import adminauth from '../../../../netlify/lib/adminauth.js';
import settings from '../../../../netlify/lib/settings.js';

const H = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (s, o) => new Response(JSON.stringify(o), { status: s, headers: H });
const ALLOWED = { avatar: 1, capa: 1, logo: 1 };

function bridgeEnv(env) {
  try { if (typeof process === 'undefined' || !process.env) return; for (const k in env) { if (typeof env[k] === 'string') process.env[k] = env[k]; } } catch (e) { /* */ }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  bridgeEnv(env);
  store.useKV(env.funil);

  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!process.env.ADMIN_PASSWORD) return json(503, { ok: false, error: 'admin_not_configured' });
  if (!adminauth.verifyToken(request.headers.get('x-admin-key') || '')) return json(401, { ok: false, error: 'unauthorized' });

  const name = String(params.name || '');
  if (!ALLOWED[name]) return json(400, { ok: false, error: 'nome_invalido' });

  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: 'invalid_form' }); }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json(400, { ok: false, error: 'sem_arquivo' });
  const ct = file.type || '';
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(ct)) return json(400, { ok: false, error: 'formato_invalido' });
  if (file.size > 4 * 1024 * 1024) return json(413, { ok: false, error: 'imagem_grande' });

  const buf = await file.arrayBuffer();
  await env.funil.put('media/' + name, buf, { metadata: { ct: ct } });
  const ver = Date.now();
  await settings.bumpMedia(name, ver);

  return json(200, { ok: true, name, ver });
}
