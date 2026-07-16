'use strict';

// Armazenamento do funil: Netlify Blobs em produção, memória no dev/testes.
// A memória some a cada restart — serve só para desenvolver. O painel /admin
// avisa quando está rodando sem Blobs (campo `storage` no summary).

const MEMORY = new Map();
let blobsStore = null;
let blobsFailed = false;
let lastError = '';

// Backend Cloudflare Workers KV (injetado pelo adaptador do Pages a cada request).
let kv = null;
function useKV(binding) { kv = binding || null; }

// Os entrypoints v2 (.mjs) importam @netlify/blobs estaticamente (garantindo o
// bundle) e injetam o getStore aqui antes do primeiro uso.
let injectedGetStore = null;
function useGetStore(fn) {
  injectedGetStore = fn;
  blobsFailed = false; // permite nova tentativa com a implementação injetada
}

async function getBlobs() {
  if (blobsStore || blobsFailed) return blobsStore;
  try {
    const getStore = injectedGetStore || require('@netlify/blobs').getStore;

    // 1º tenta a configuração automática do runtime; se o runtime não injetar
    // o contexto, cai para a configuração manual via env vars.
    const candidates = [];
    candidates.push(() => getStore('funil'));
    if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
      candidates.push(() => getStore({
        name: 'funil',
        siteID: process.env.BLOBS_SITE_ID,
        token: process.env.BLOBS_TOKEN,
      }));
    }

    for (const make of candidates) {
      try {
        const store = make();
        await store.get('__ping__'); // valida acesso de verdade
        blobsStore = store;
        return blobsStore;
      } catch (error) {
        lastError = error.message || String(error);
      }
    }
    blobsFailed = true;
  } catch (error) {
    lastError = error.message || String(error);
    blobsFailed = true;
  }
  return blobsStore;
}

async function setJSON(key, value) {
  if (kv) { await kv.put(key, JSON.stringify(value)); return; }
  const store = await getBlobs();
  if (store) {
    await store.setJSON(key, value);
  } else {
    MEMORY.set(key, JSON.stringify(value));
  }
}

async function getJSON(key) {
  if (kv) { return await kv.get(key, 'json'); }
  const store = await getBlobs();
  if (store) {
    return await store.get(key, { type: 'json' });
  }
  const raw = MEMORY.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function listKeys(prefix) {
  if (kv) {
    const out = [];
    let cursor;
    let done = false;
    while (!done) {
      const r = await kv.list({ prefix, cursor });
      r.keys.forEach((k) => out.push(k.name));
      done = r.list_complete;
      cursor = r.cursor;
    }
    return out;
  }
  const store = await getBlobs();
  if (store) {
    const { blobs } = await store.list({ prefix });
    return blobs.map((b) => b.key);
  }
  return [...MEMORY.keys()].filter((k) => k.startsWith(prefix));
}

async function del(key) {
  if (kv) { await kv.delete(key); return; }
  const store = await getBlobs();
  if (store) {
    await store.delete(key);
  } else {
    MEMORY.delete(key);
  }
}

async function storageKind() {
  if (kv) return 'kv';
  return (await getBlobs()) ? 'blobs' : 'memory';
}

function storageError() {
  return lastError;
}

// Dia no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
function dayKey(ts = Date.now()) {
  return new Date(ts - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = { setJSON, getJSON, listKeys, del, storageKind, storageError, dayKey, useGetStore, useKV };
