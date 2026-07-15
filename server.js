'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Reaproveita exatamente os mesmos handlers do Netlify no dev local.
const checkoutFn = require('./netlify/functions/checkout');
const statusFn = require('./netlify/functions/status');
const webhookFn = require('./netlify/functions/webhook');
const trackFn = require('./netlify/functions/track');
const adminFn = require('./netlify/functions/admin');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const API_ROUTES = {
  '/api/checkout': checkoutFn,
  '/api/status': statusFn,
  '/api/webhook': webhookFn,
  '/api/track': trackFn,
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(raw));
  });
}

async function handleApi(fn, req, res, url) {
  const body = await readBody(req);
  const queryStringParameters = {};
  url.searchParams.forEach((value, key) => { queryStringParameters[key] = value; });

  const event = {
    httpMethod: req.method,
    path: url.pathname,
    headers: { ...req.headers, 'x-forwarded-proto': 'http' },
    body,
    queryStringParameters,
  };

  const result = await fn.handler(event);
  res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(result.body || '');
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    const route = url.pathname.startsWith('/api/admin') ? adminFn : API_ROUTES[url.pathname];
    if (route) {
      try {
        await handleApi(route, req, res, url);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'server_error' }));
      }
      return;
    }

    const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const safeRoot = path.resolve(ROOT);
    const safePath = path.resolve(safeRoot, `.${requestPath}`);

    if (!safePath.startsWith(safeRoot + path.sep) && safePath !== safeRoot) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    serveFile(res, safePath);
  });
}

function startServer(port = PORT) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  startServer().then((server) => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : PORT;
    console.log(`Server running at http://localhost:${actualPort}`);
  });
}

module.exports = { createServer, startServer };
