const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listarPacotes, obterPacote } = require('../lib/creditos-crm');

test('listarPacotes: 9 pacotes, valor = quantidade x preço unitário (faixas do Bruno, 2026-10-21)', () => {
  const pacotes = listarPacotes();
  assert.equal(pacotes.length, 9);
  const esperado = {
    creditos_100: 60, creditos_250: 150,
    creditos_300: 165, creditos_500: 275,
    creditos_600: 300, creditos_1000: 500,
    creditos_1200: 540, creditos_1600: 720, creditos_2000: 900,
  };
  for (const p of pacotes) {
    assert.equal(p.valor, esperado[p.chave], `pacote ${p.chave}`);
  }
});

test('obterPacote: resolve pela chave, null quando não existe', () => {
  assert.deepEqual(obterPacote('creditos_600'), { chave: 'creditos_600', quantidade: 600, preco_unitario: 0.50, valor: 300 });
  assert.equal(obterPacote('creditos_999'), null);
});
