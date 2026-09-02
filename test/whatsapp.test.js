const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarWhatsapp } = require('../lib/whatsapp');

// Cópia verbatim de kyvvo/server/panel/lib/whatsapp.js — cobertura mínima pra
// garantir que a cópia não regrediu.
describe('normalizarWhatsapp', () => {
  test('celular com DDD (11 dígitos) passa como está', () => {
    assert.equal(normalizarWhatsapp('34999887766'), '34999887766');
  });

  test('fixo com DDD (10 dígitos) também é aceito', () => {
    assert.equal(normalizarWhatsapp('3433221100'), '3433221100');
  });

  test('formatação humana é limpa', () => {
    assert.equal(normalizarWhatsapp('(34) 99988-7766'), '34999887766');
  });

  test('DDI 55 é removido', () => {
    assert.equal(normalizarWhatsapp('5534999887766'), '34999887766');
  });

  test('vazio / curto / DDD inválido → null', () => {
    assert.equal(normalizarWhatsapp(''), null);
    assert.equal(normalizarWhatsapp(null), null);
    assert.equal(normalizarWhatsapp('99887766'), null);
    assert.equal(normalizarWhatsapp('01999887766'), null);
  });
});
