'use strict';

// Textos do bot, editáveis pelo painel.
//
// Regra que sustenta o arquivo: o PADRÃO mora aqui, no código. O que o painel
// grava são apenas substituições. Assim, chave ausente, documento corrompido
// ou campo apagado nunca deixam o bot mudo — cai no padrão.
//
// Fica fora de config/settings.json de propósito: settings é lido no checkout
// e servido publicamente, e não faz sentido carregar (nem arriscar expor) a
// copy adulta em toda requisição da loja.

const { getJSON, setJSON } = require('../store');
const tg = require('../telegram');

const CHAVE = 'bot/copy.json';
const LIMITE_BOTAO = 32;
const LIMITE_TEXTO = 900;

/** Padrões — a verdade. Cada chave documenta onde aparece. */
const PADROES = {
  // --- abertura ---
  'start.saudacao': 'Oi{nome} 😏\n\nAntes de eu te mostrar o que separei… você é maior de 18?',
  'age.ok': 'Boa 😏 então vem comigo…',
  'age.negado': 'Sem problema 💛 esse conteúdo é só para maiores de 18.',

  // --- sequência de prévias ---
  'previas.vazio': 'Ainda estou preparando as prévias 🙈 volta daqui a pouco!',
  'previas.catalogo_mudou': 'Atualizei as prévias — segue daqui 👇',
  'previas.final': 'Aqui eu tenho que parar 🙈\n\nO resto não cabe no Telegram público — tá tudo no VIP, sem corte.',
  'fallback.sem_start': 'Manda /start que eu te mostro o que separei 😏',

  // --- acesso ---
  'venda.boas_vindas': 'Bem-vindo(a) pro VIP 🔥\n\nSeu acesso tá aqui — o link é só seu e vale por 24h.\nVálido até <b>{venc}</b>.',
  'venda.fallback_link': 'Tive um probleminha pra gerar seu convite. Use este link e, se não funcionar, me chama:',
  'acesso.sem_assinatura': 'Não achei uma assinatura ativa nesse seu perfil 🤔\n\nSe você comprou com outro Telegram, me diga o e-mail usado na compra que eu verifico.',
  'acesso.vencido': 'Seu acesso venceu 😢 mas dá pra voltar agora mesmo:',
  'acesso.limite_diario': 'Já te mandei o link várias vezes hoje 🙈 tenta amanhã ou me chama no /suporte.',
  'acesso.erro_interno': 'Tive um problema aqui — já avisei a equipe, me chama no /suporte 🙏',
  'acesso.erro_link': 'Não consegui gerar o link agora 😞 tenta de novo em alguns minutos.',
  'acesso.link_ok': 'Aqui está 👇 vale por {minutos} minutos.',
  'entrada.negada': 'Não achei uma assinatura ativa nesse seu perfil 🤔\n\nSe você já pagou, manda /acesso que eu verifico.',

  // --- situação ---
  'status.ativo': 'Seu VIP está ativo ✅\n\nPlano: <b>{plano}</b>\nVence em <b>{venc}</b> ({dias} dia{s})',
  'status.vencido': 'Seu acesso venceu em <b>{venc}</b> 😢',
  'status.sem_vip': 'Você ainda não tem VIP ativo por aqui 😌',

  // --- resgate da compra ---
  'claim.nao_pago': 'Esse pagamento ainda não consta como confirmado 🤔 assim que cair, é só apertar o botão de novo.',
  'claim.invalido': 'Esse link de acesso não vale mais. Manda /acesso que eu verifico sua compra.',

  // --- vencimento (agendador) ---
  'venc.aviso': 'Oi {nome}! Seu acesso VIP vence em {dias} dia{s}.',
  'venc.fim': 'Seu acesso VIP chegou ao fim 💔\n\nQuando quiser voltar, é só clicar aqui:',

  // --- suporte ---
  'suporte.resposta': 'Precisa de ajuda? Me chama por aqui que eu te respondo 💬',

  // --- rótulos de botão ---
  'btn.age_sim': 'Sim, sou maior 🔥',
  'btn.age_nao': 'Não',
  'btn.proximo': 'ver mais 🔥\nquero o resto 😏\nmais uma 🙈\ncontinua 👀',
  'btn.cta': 'quero tudo agora ➜',
  'btn.cta_final': 'VER TUDO ➜',
  'btn.entrar_vip': 'ENTRAR NO VIP ➜',
  'btn.renovar': 'RENOVAR ➜',
  'btn.quero_entrar': 'QUERO ENTRAR ➜',
  'btn.winback': 'VOLTAR PRO VIP ➜',
};

/** Variáveis aceitas por chave. O que não estiver aqui é recusado ao salvar. */
const VARS = {
  'start.saudacao': ['nome'],
  'venda.boas_vindas': ['venc'],
  'acesso.link_ok': ['minutos'],
  'status.ativo': ['plano', 'venc', 'dias', 's'],
  'status.vencido': ['venc'],
  'venc.aviso': ['nome', 'dias', 's'],
  'venc.fim': ['nome'],
};

/** Agrupamento só para a tela do painel. */
const GRUPOS = [
  { id: 'abertura', nome: 'Abertura e 18+', chaves: ['start.saudacao', 'btn.age_sim', 'btn.age_nao', 'age.ok', 'age.negado'] },
  { id: 'previas', nome: 'Sequência de prévias', chaves: ['btn.proximo', 'btn.cta', 'btn.cta_final', 'previas.final', 'previas.vazio', 'previas.catalogo_mudou', 'fallback.sem_start'] },
  { id: 'acesso', nome: 'Acesso ao VIP', chaves: ['venda.boas_vindas', 'btn.entrar_vip', 'venda.fallback_link', 'acesso.link_ok', 'acesso.sem_assinatura', 'acesso.vencido', 'acesso.limite_diario', 'acesso.erro_link', 'acesso.erro_interno', 'entrada.negada'] },
  { id: 'situacao', nome: 'Situação e resgate', chaves: ['status.ativo', 'status.vencido', 'status.sem_vip', 'btn.quero_entrar', 'claim.nao_pago', 'claim.invalido', 'suporte.resposta'] },
  { id: 'vencimento', nome: 'Vencimento e volta', chaves: ['venc.aviso', 'btn.renovar', 'venc.fim', 'btn.winback'] },
];

const ehBotao = (chave) => chave.startsWith('btn.');
const limiteDe = (chave) => (ehBotao(chave) ? LIMITE_BOTAO : LIMITE_TEXTO);

/* ---------- leitura ---------- */

// Cache por isolate. Existe sobretudo para o disparo em massa: 250 envios numa
// execução não podem virar 250 leituras do banco.
let cache = null;
let cacheEm = 0;
const CACHE_MS = 60000;

async function carregar(forcar) {
  if (!forcar && cache && Date.now() - cacheEm < CACHE_MS) return cache;
  let doc = null;
  try { doc = await getJSON(CHAVE); } catch { /* cai no padrão */ }
  cache = (doc && doc.textos) || {};
  cacheEm = Date.now();
  return cache;
}

/** Aplica {variaveis}, sempre escapando o valor — a marcação do texto sobrevive. */
function aplicar(texto, vars = {}) {
  return String(texto || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : tg.esc(vars[k])));
}

/**
 * Texto pronto para enviar.
 * Campo vazio ou só espaços significa "voltar ao padrão", nunca "mandar
 * mensagem vazia" — que o Telegram recusaria.
 */
/**
 * @param padraoAlt texto que substitui o padrão quando o catálogo ainda não foi
 *   editado. Serve para não descartar em silêncio uma mensagem que a dona já
 *   tinha personalizado em outro lugar do painel antes do catálogo existir.
 */
async function txt(chave, vars = {}, padraoAlt) {
  const textos = await carregar();
  const bruto = textos[chave];
  const partida = (typeof padraoAlt === 'string' && padraoAlt.trim()) ? padraoAlt : PADROES[chave];
  const escolhido = (typeof bruto === 'string' && bruto.trim()) ? bruto : partida;
  if (escolhido == null) {
    console.error('copy: chave sem padrão:', chave);
    return '';
  }
  // Plural automático: "{dias} dia{s}" vira "3 dias" ou "1 dia".
  const comPlural = { s: Number(vars.dias) === 1 ? '' : 's', ...vars };
  return aplicar(escolhido, comPlural);
}

/** Rótulos de avanço: um por linha, rotacionados pela posição da prévia. */
async function rotuloProximo(idx) {
  const bruto = await txt('btn.proximo');
  const linhas = bruto.split('\n').map((l) => l.trim()).filter(Boolean);
  const lista = linhas.length ? linhas : PADROES['btn.proximo'].split('\n');
  return lista[idx % lista.length];
}

/* ---------- escrita (painel) ---------- */

/** Valida uma substituição. @returns {{ok:boolean, erro?:string}} */
function validar(chave, texto) {
  if (!(chave in PADROES)) return { ok: false, erro: 'Mensagem desconhecida.' };
  const s = String(texto == null ? '' : texto);
  if (!s.trim()) return { ok: true }; // vazio = voltar ao padrão

  const limite = limiteDe(chave);
  if (Array.from(s).length > limite) {
    return { ok: false, erro: `Máximo de ${limite} caracteres aqui.` };
  }

  const permitidas = VARS[chave] || [];
  const usadas = [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const v of usadas) {
    if (!permitidas.includes(v)) {
      return {
        ok: false,
        erro: permitidas.length
          ? `Aqui só valem ${permitidas.filter((p) => p !== 's').map((p) => '{' + p + '}').join(' e ')}.`
          : 'Esta mensagem não aceita variáveis.',
      };
    }
  }

  // Botão não aceita marcação; texto aceita, mas precisa ser válida.
  if (ehBotao(chave)) {
    if (/[<>]/.test(s)) return { ok: false, erro: 'Botão não aceita marcação.' };
    return { ok: true };
  }
  return tg.validarHtml(s);
}

/** Grava as substituições. Só aceita o lote inteiro se tudo for válido. */
async function salvar(alteracoes) {
  const erros = [];
  for (const [chave, texto] of Object.entries(alteracoes || {})) {
    const v = validar(chave, texto);
    if (!v.ok) erros.push({ chave, erro: v.erro });
  }
  if (erros.length) return { ok: false, erros };

  const doc = (await getJSON(CHAVE)) || { v: 0, textos: {} };
  doc.textos = doc.textos || {};
  for (const [chave, texto] of Object.entries(alteracoes)) {
    const s = String(texto == null ? '' : texto);
    if (s.trim()) doc.textos[chave] = tg.cortar(s, limiteDe(chave));
    else delete doc.textos[chave]; // apagar devolve o padrão
  }
  doc.v = (doc.v || 0) + 1;
  doc.updatedAt = Date.now();
  await setJSON(CHAVE, doc);
  cache = doc.textos;
  cacheEm = Date.now();
  return { ok: true, v: doc.v };
}

/** Tudo que a tela precisa: padrão, valor atual, variáveis e limite. */
async function listar() {
  const textos = await carregar(true);
  const grupos = GRUPOS.map((g) => ({
    id: g.id,
    nome: g.nome,
    itens: g.chaves.map((chave) => ({
      chave,
      padrao: PADROES[chave],
      valor: textos[chave] || '',
      vars: (VARS[chave] || []).filter((v) => v !== 's'),
      limite: limiteDe(chave),
      botao: ehBotao(chave),
    })),
  }));
  // Chaves gravadas que não existem mais no código — a tela marca para limpar.
  const orfas = Object.keys(textos).filter((k) => !(k in PADROES));
  return { grupos, orfas };
}

module.exports = {
  CHAVE, PADROES, VARS, GRUPOS,
  carregar, txt, aplicar, rotuloProximo,
  validar, salvar, listar, limiteDe,
};
