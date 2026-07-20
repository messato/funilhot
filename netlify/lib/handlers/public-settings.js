'use strict';

const { getSettings, publicView } = require('../settings');
const { getFlags } = require('../features');

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' };

// Só estas flags são expostas ao público (usadas pelas páginas do funil).
const PUBLIC_FLAGS = ['verificacao_idade', 'downsell_auto', 'quiz', 'order_bump', 'cupons', 'prova_social'];

// Endpoint público (sem senha): só expõe o que as páginas do funil precisam.
exports.handler = async function () {
  try {
    const [s, flags] = await Promise.all([getSettings(), getFlags()]);
    const features = {};
    PUBLIC_FLAGS.forEach((f) => { features[f] = !!flags[f]; });
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, settings: publicView(s), features }) };
  } catch (error) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: false }) };
  }
};
