const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { dadosDaRequest } = require('../lib/auditoria');

describe('dadosDaRequest', () => {
  test('sem request / sem headers → nulls', () => {
    assert.deepEqual(dadosDaRequest(null), { ip: null, userAgent: null });
    assert.deepEqual(dadosDaRequest({}), { ip: null, userAgent: null });
  });

  test('x-forwarded-for: usa o primeiro IP da lista', () => {
    const r = {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'curl/8' },
      ip: '10.0.0.1',
    };
    assert.deepEqual(dadosDaRequest(r), { ip: '203.0.113.7', userAgent: 'curl/8' });
  });

  test('sem forwarded: cai no request.ip', () => {
    const r = { headers: { 'user-agent': 'x' }, ip: '198.51.100.4' };
    assert.deepEqual(dadosDaRequest(r), { ip: '198.51.100.4', userAgent: 'x' });
  });

  test('sem nada de origem: ip null, user-agent null', () => {
    assert.deepEqual(dadosDaRequest({ headers: {} }), { ip: null, userAgent: null });
  });
});
