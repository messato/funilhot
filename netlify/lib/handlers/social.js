'use strict';

const { verifyToken, headerKey } = require('../adminauth');
const { setJSON, getJSON, listKeys, dayKey } = require('../store');
const { listAccounts, NETWORKS } = require('../social');
const { rateLimit, clientIp } = require('../ratelimit');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const reply = (statusCode, payload) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(payload) });
const DAY_MS = 24 * 3600 * 1000;

function monthOf(ts) { return dayKey(ts).slice(0, 7); }

// Registro de publicações no KV: social/<yyyy-mm>/<id>.json
async function savePost(rec) {
  await setJSON(`social/${monthOf(rec.createdAt)}/${rec.id}.json`, rec);
}
async function getPost(id) {
  const now = new Date();
  const months = [monthOf(), monthOf(now.setMonth(now.getMonth() - 1))];
  for (const m of months) {
    const rec = await getJSON(`social/${m}/${id}.json`);
    if (rec) return rec;
  }
  return null;
}
async function listPosts(sinceTs) {
  const months = new Set();
  for (let ts = sinceTs; ts <= Date.now(); ts += 20 * DAY_MS) months.add(monthOf(ts));
  months.add(monthOf());
  const out = [];
  for (const m of months) {
    const keys = await listKeys(`social/${m}/`);
    const loaded = await Promise.all(keys.map((k) => getJSON(k)));
    loaded.forEach((o) => { if (o && o.createdAt >= sinceTs) out.push(o); });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

exports.handler = async function (event) {
  if (!process.env.ADMIN_PASSWORD) return reply(503, { ok: false, error: 'admin_not_configured' });
  if (!rateLimit('social:' + clientIp(event), { limit: 120, windowMs: 60000 }).ok) {
    return reply(429, { ok: false, error: 'rate_limited' });
  }
  if (!verifyToken(headerKey(event))) return reply(401, { ok: false, error: 'unauthorized' });

  const m = (event.path || '').match(/\/social\/?([^/?]*)/);
  const route = m ? m[1] : '';
  const q = event.queryStringParameters || {};

  try {
    if (route === 'accounts') {
      const acc = await listAccounts();
      return reply(200, { ok: true, provider: acc.provider, accounts: acc.accounts, networks: NETWORKS });
    }
    if (route === 'posts') {
      const days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 30));
      const posts = await listPosts(Date.now() - days * DAY_MS);
      return reply(200, { ok: true, posts: posts.slice(0, 200) });
    }
    if (route === 'kwai-done' && event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
      const rec = await getPost(String(body.id || ''));
      if (!rec) return reply(404, { ok: false, error: 'not_found' });
      rec.kwai = 'done';
      await savePost(rec);
      return reply(200, { ok: true });
    }
    return reply(404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error('social error:', error.message);
    return reply(500, { ok: false, error: 'internal' });
  }
};

exports.savePost = savePost;
exports.listPosts = listPosts;
