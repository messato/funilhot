'use strict';

// Adaptador: converte Request (Functions v2) para o formato de evento v1 usado
// pelos handlers em lib/handlers, e o resultado de volta para Response.
// Motivo da migração: só o runtime v2 recebe o contexto do Netlify Blobs.

async function toEvent(req) {
  const url = new URL(req.url);
  const headers = {};
  req.headers.forEach((value, key) => { headers[key] = value; });

  const queryStringParameters = {};
  url.searchParams.forEach((value, key) => { queryStringParameters[key] = value; });

  return {
    httpMethod: req.method,
    path: url.pathname,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text(),
    queryStringParameters,
  };
}

function toResponse(result) {
  const status = result.statusCode || 200;
  // Status "sem corpo" (204/205/304) exigem body null — string vazia é inválida.
  const body = [101, 204, 205, 304].includes(status) ? null : (result.body || '');
  return new Response(body, {
    status,
    headers: result.headers || {},
  });
}

function wrap(handler) {
  return async (req) => toResponse(await handler(await toEvent(req)));
}

module.exports = { toEvent, toResponse, wrap };
