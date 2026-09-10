const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { renderizar, extrairPlaceholders } = require('../lib/templates');

describe('renderizar', () => {
  test('posicional {{1}}/{{2}} pela ordem das variáveis', () => {
    const vars = [
      { nome: 'cliente', exemplo: 'Ana' },
      { nome: 'servico', exemplo: 'Corte' },
    ];
    assert.equal(renderizar('Oi {{1}}, seu {{2}} está confirmado', vars), 'Oi Ana, seu Corte está confirmado');
  });

  test('nomeado {{nome}} casa pelo nome', () => {
    assert.equal(
      renderizar('Oi {{cliente}}', [{ nome: 'cliente', exemplo: 'Bia' }]),
      'Oi Bia',
    );
  });

  test('placeholder sem valor vira vazio (não deixa {{x}})', () => {
    assert.equal(renderizar('Oi {{cliente}}, {{sobra}}', [{ nome: 'cliente', exemplo: 'X' }]), 'Oi X, ');
  });

  test('corpo nulo / sem variáveis', () => {
    assert.equal(renderizar(null), '');
    assert.equal(renderizar('sem placeholder'), 'sem placeholder');
  });
});

describe('extrairPlaceholders', () => {
  test('na ordem, sem repetir', () => {
    assert.deepEqual(extrairPlaceholders('{{a}} {{b}} {{a}} {{ c }}'), ['a', 'b', 'c']);
  });
  test('vazio quando não há', () => {
    assert.deepEqual(extrairPlaceholders('texto puro'), []);
  });
});
