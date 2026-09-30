const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { criarArmazenamentoHandoff, tokenInternoValido, CODIGO_TTL_MS } = require('../routes/handoff');

describe('tokenInternoValido', () => {
  test('header igual ao esperado passa', () => {
    assert.equal(tokenInternoValido('segredo-123', 'segredo-123'), true);
  });
  test('header diferente é recusado', () => {
    assert.equal(tokenInternoValido('errado', 'segredo-123'), false);
  });
  test('header ausente é recusado', () => {
    assert.equal(tokenInternoValido(undefined, 'segredo-123'), false);
  });
  test('sem INTERNAL_HANDOFF_TOKEN configurado no ambiente, nunca autentica (nem com header vazio)', () => {
    assert.equal(tokenInternoValido('', undefined), false);
    assert.equal(tokenInternoValido('qualquercoisa', undefined), false);
  });
});

describe('criarArmazenamentoHandoff — criar/verificar', () => {
  test('roundtrip: cria um código e verifica devolve o payload certo', () => {
    const armazenamento = criarArmazenamentoHandoff();
    const code = armazenamento.criar({ tenantId: 't1', userId: 'u1', email: 'dona@salao.com', nome: 'Ana' });
    assert.equal(typeof code, 'string');
    assert.ok(code.length >= 32);
    const payload = armazenamento.verificar(code);
    assert.deepEqual(payload, { tenantId: 't1', userId: 'u1', email: 'dona@salao.com', nome: 'Ana', outrosProdutos: [] });
  });

  test('userId/nome ausentes viram null (produto que não manda esses campos)', () => {
    const armazenamento = criarArmazenamentoHandoff();
    const code = armazenamento.criar({ tenantId: 't1', email: 'dona@salao.com' });
    const payload = armazenamento.verificar(code);
    assert.deepEqual(payload, { tenantId: 't1', userId: null, email: 'dona@salao.com', nome: null, outrosProdutos: [] });
  });

  test('outrosProdutos repassado tal como veio (quem gerou o código já manda pronto, do ponto de vista do destino)', () => {
    const armazenamento = criarArmazenamentoHandoff();
    const lista = [{ chave: 'studio', nome: 'Studio', url: 'https://studio.kyvvo.com.br' }];
    const code = armazenamento.criar({ tenantId: 't1', email: 'dona@salao.com', outrosProdutos: lista });
    const payload = armazenamento.verificar(code);
    assert.deepEqual(payload.outrosProdutos, lista);
  });

  test('tenantId ausente lança erro', () => {
    const armazenamento = criarArmazenamentoHandoff();
    assert.throws(() => armazenamento.criar({ email: 'dona@salao.com' }), /tenantId e email são obrigatórios/);
  });

  test('email ausente lança erro', () => {
    const armazenamento = criarArmazenamentoHandoff();
    assert.throws(() => armazenamento.criar({ tenantId: 't1' }), /tenantId e email são obrigatórios/);
  });

  test('código é de USO ÚNICO — a segunda verificação do mesmo código falha', () => {
    const armazenamento = criarArmazenamentoHandoff();
    const code = armazenamento.criar({ tenantId: 't1', email: 'dona@salao.com' });
    assert.ok(armazenamento.verificar(code));
    assert.equal(armazenamento.verificar(code), null);
  });

  test('código inexistente devolve null (não lança)', () => {
    const armazenamento = criarArmazenamentoHandoff();
    assert.equal(armazenamento.verificar('codigo-que-nunca-existiu'), null);
  });

  test('código expirado devolve null (TTL curto de propósito — handoff é pra uso imediato)', (t) => {
    const armazenamento = criarArmazenamentoHandoff();
    const code = armazenamento.criar({ tenantId: 't1', email: 'dona@salao.com' });
    const relogioOriginal = Date.now;
    t.mock.method(Date, 'now', () => relogioOriginal() + CODIGO_TTL_MS + 1000);
    assert.equal(armazenamento.verificar(code), null);
    t.mock.restoreAll();
  });

  test('dois códigos gerados são diferentes entre si', () => {
    const armazenamento = criarArmazenamentoHandoff();
    const code1 = armazenamento.criar({ tenantId: 't1', email: 'a@a.com' });
    const code2 = armazenamento.criar({ tenantId: 't1', email: 'a@a.com' });
    assert.notEqual(code1, code2);
  });

  test('códigos de armazenamentos diferentes não se misturam (isolamento entre instâncias)', () => {
    const armazenamento1 = criarArmazenamentoHandoff();
    const armazenamento2 = criarArmazenamentoHandoff();
    const code = armazenamento1.criar({ tenantId: 't1', email: 'a@a.com' });
    assert.equal(armazenamento2.verificar(code), null);
  });
});
