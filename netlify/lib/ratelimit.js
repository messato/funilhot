'use strict';

// Rate limit simples, em memória. Em serverless o container pode ser reciclado,
// então é "best-effort" — reduz abuso/spam sem depender de infra externa.
const HITS = new Map();

function rateLimit(key, { limit = 12, windowMs = 60000 } = {}) {
  const now = Date.now();
  const entry = HITS.get(key);

  if (!entry || now > entry.reset) {
    HITS.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  entry.count += 1;
  if (entry.count > limit) return { ok: false, remaining: 0 };
  return { ok: true, remaining: limit - entry.count };
}

function clientIp(event) {
  const h = (event && event.headers) || {};
  const raw = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || h['client-ip'] || 'unknown';
  return String(raw).split(',')[0].trim() || 'unknown';
}

module.exports = { rateLimit, clientIp };
