'use strict';

// Armazenamento do funil: Netlify Blobs em produção, memória no dev/testes.
// A memória some a cada restart — serve só para desenvolver. O painel /admin
// avisa quando está rodando sem Blobs (campo `storage` no summary).

const MEMORY = new Map();
let blobsStore = null;
let blobsFailed = false;

async function getBlobs() {
  if (blobsStore || blobsFailed) return blobsStore;
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('funil');
    // valida acesso de verdade — em ambiente local getStore existe mas falha ao usar
    await store.get('__ping__');
    blobsStore = store;
  } catch {
    blobsFailed = true;
  }
  return blobsStore;
}

async function setJSON(key, value) {
  const store = await getBlobs();
  if (store) {
    await store.setJSON(key, value);
  } else {
    MEMORY.set(key, JSON.stringify(value));
  }
}

async function getJSON(key) {
  const store = await getBlobs();
  if (store) {
    return await store.get(key, { type: 'json' });
  }
  const raw = MEMORY.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function listKeys(prefix) {
  const store = await getBlobs();
  if (store) {
    const { blobs } = await store.list({ prefix });
    return blobs.map((b) => b.key);
  }
  return [...MEMORY.keys()].filter((k) => k.startsWith(prefix));
}

async function del(key) {
  const store = await getBlobs();
  if (store) {
    await store.delete(key);
  } else {
    MEMORY.delete(key);
  }
}

async function storageKind() {
  return (await getBlobs()) ? 'blobs' : 'memory';
}

// Dia no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
function dayKey(ts = Date.now()) {
  return new Date(ts - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = { setJSON, getJSON, listKeys, del, storageKind, dayKey };
