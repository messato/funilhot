// Adaptador Cloudflare Pages Functions -> handlers existentes (netlify/lib).
// Converte Request do Cloudflare no "event" que os handlers esperam e o
// retorno { statusCode, headers, body } de volta em Response.
import store from '../netlify/lib/store.js';

// Copia os bindings/segredos (context.env) para process.env, já que os handlers
// leem via process.env. KV e outros não-strings são ignorados.
function bridgeEnv(env) {
  try {
    if (typeof process === 'undefined' || !process.env) return;
    for (const k in env) { if (typeof env[k] === 'string') process.env[k] = env[k]; }
  } catch { /* process pode não existir; ignore */ }
}

export async function toEvent(request) {
  const url = new URL(request.url);
  const queryStringParameters = {};
  url.searchParams.forEach((v, k) => { queryStringParameters[k] = v; });

  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  headers['x-forwarded-proto'] = url.protocol.replace(':', '');
  if (!headers['x-nf-client-connection-ip']) headers['x-nf-client-connection-ip'] = headers['cf-connecting-ip'] || '';

  let body = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') body = await request.text();

  return { httpMethod: request.method, path: url.pathname, headers, body, queryStringParameters };
}

export function toResponse(result) {
  return new Response(result.body || '', {
    status: result.statusCode || 200,
    headers: result.headers || { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Envolve um handler para uso como onRequest do Pages Functions.
export function wrap(handler) {
  return async function (context) {
    bridgeEnv(context.env);
    store.useKV(context.env.funil);
    return toResponse(await handler(await toEvent(context.request)));
  };
}
