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
  return new Response(result.body || '', {
    status: result.statusCode || 200,
    headers: result.headers || {},
  });
}

function wrap(handler) {
  return async (req) => toResponse(await handler(await toEvent(req)));
}

module.exports = { toEvent, toResponse, wrap };
