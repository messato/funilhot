'use strict';

const { getSettings, publicView } = require('../settings');

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' };

// Endpoint público (sem senha): só expõe o que as páginas do funil precisam.
exports.handler = async function () {
  try {
    const s = await getSettings();
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, settings: publicView(s) }) };
  } catch (error) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: false }) };
  }
};
