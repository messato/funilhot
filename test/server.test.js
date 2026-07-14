const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

function withServer(run) {
  return async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      await run(base);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

test('POST /api/checkout cria cobrança e resolve o preço no servidor', withServer(async (base) => {
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer: 'checkout', plan: 'mensal', nome: 'Ana', email: 'ana@example.com', telefone: '11999998888', cpf: '11144477735', valor: 'R$ 0,01' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  // preço vem do catálogo do servidor, ignorando o "valor" enviado pelo cliente
  assert.equal(body.data.amount, 3990);
  assert.ok(body.data.id);
  // não vaza resposta crua do provedor
  assert.equal(body.data.providerResponse, undefined);
}));

test('rejeita offer/plan desconhecidos (anti price tampering)', withServer(async (base) => {
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer: 'checkout', plan: 'gratis', nome: 'Ana', email: 'ana@example.com', telefone: '11999998888', cpf: '11144477735' }),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_offer');
}));

test('rejeita e-mail inválido', withServer(async (base) => {
  const response = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer: 'checkout', plan: 'mensal', nome: 'Ana', email: 'nao-eh-email' }),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_fields');
}));

test('GET /api/status retorna paid em modo stub', withServer(async (base) => {
  const created = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer: 'checkout', plan: 'anual', nome: 'Ana', email: 'ana@example.com', telefone: '11999998888', cpf: '11144477735' }),
  }).then((r) => r.json());

  const status = await fetch(`${base}/api/status?id=${encodeURIComponent(created.data.id)}`).then((r) => r.json());
  assert.equal(status.ok, true);
  assert.equal(status.paid, true);
}));
