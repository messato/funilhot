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

test('POST /api/track grava evento de visualização', withServer(async (base) => {
  const response = await fetch(`${base}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 'landing', vid: 'v-teste-123', us: 'instagram', m: 1 }),
  });
  assert.equal(response.status, 204);
}));

test('admin: login por senha emite token e protege as rotas', withServer(async (base) => {
  process.env.ADMIN_PASSWORD = 'senha-de-teste';

  // sem token -> 401
  const noAuth = await fetch(`${base}/api/admin/summary`);
  assert.equal(noAuth.status, 401);

  // senha errada no login -> 401
  const badLogin = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'errada' }),
  });
  assert.equal(badLogin.status, 401);

  // login correto -> token
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-de-teste' }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200);
  assert.ok(loginBody.token);

  // token inválido -> 401
  const forged = await fetch(`${base}/api/admin/summary`, { headers: { 'x-admin-key': '999.abc' } });
  assert.equal(forged.status, 401);

  // token válido -> 200 com métricas
  const ok = await fetch(`${base}/api/admin/summary?days=7`, { headers: { 'x-admin-key': loginBody.token } });
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.daily));
  assert.ok(Array.isArray(body.funnel));
  assert.ok(body.kpis);
  assert.ok(body.goal);
  assert.ok(Array.isArray(body.heatmap));

  delete process.env.ADMIN_PASSWORD;
}));

test('admin: lança gasto e reflete ROAS no summary', withServer(async (base) => {
  process.env.ADMIN_PASSWORD = 'senha-roas';
  const token = (await (await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-roas' }),
  })).json()).token;

  const spend = await fetch(`${base}/api/admin/spend`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': token },
    body: JSON.stringify({ source: 'instagram', amount: 100 }),
  });
  assert.equal(spend.status, 200);

  const s = await (await fetch(`${base}/api/admin/summary?days=1`, { headers: { 'x-admin-key': token } })).json();
  assert.equal(s.kpis.spend, 10000); // R$100 -> 10000 centavos
  delete process.env.ADMIN_PASSWORD;
}));
