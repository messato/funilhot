'use strict';

// Autenticação do painel: senha -> token de sessão assinado (HMAC) com validade.
// Compartilhado entre o handler do admin e o de publicações.
const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 3600 * 1000;

function sign(data) {
  return crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || '').update(data).digest('base64url');
}

function makeToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return exp + '.' + sign(exp);
}

function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  const expected = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Date.now() < Number(exp);
}

function passwordMatches(given) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function headerKey(event) {
  const h = (event && event.headers) || {};
  return h['x-admin-key'] || h['X-Admin-Key'] || '';
}

module.exports = { TOKEN_TTL_MS, makeToken, verifyToken, passwordMatches, headerKey };
