const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Sem PLATFORM_JWT_*_KEY no ambiente, lib/jwt-rs256 (via admin-session) gera
// um par efêmero no boot — suficiente pra exercitar assinar/verificar aqui.
const adminSession = require('../lib/admin-session');
const jwtRs256 = require('../lib/jwt-rs256');

const ADMIN = { id: 'adm-1', email: 'op@kyvvo.com.br', nome: 'Operador' };

describe('admin-session', () => {
  test('assinar → verificar: roundtrip com aud "admin"', () => {
    const payload = adminSession.verificar(adminSession.assinar(ADMIN));
    assert.equal(payload.aud, 'admin');
    assert.equal(payload.adminId, 'adm-1');
    assert.equal(payload.email, 'op@kyvvo.com.br');
    assert.equal(payload.nome, 'Operador');
    assert.equal(payload.iss, jwtRs256.ISSUER);
  });

  test('token sem aud "admin" é recusado (token de tenant não serve)', () => {
    const tokenTenant = jwtRs256.sign({ userId: 'u-1', tenantId: 't-1' });
    assert.throws(() => adminSession.verificar(tokenTenant), /aud inválida/);
  });

  test('token com aud errada é recusado', () => {
    const tokenOutro = jwtRs256.sign({ aud: 'outro', adminId: 'adm-1' });
    assert.throws(() => adminSession.verificar(tokenOutro), /aud inválida/);
  });

  test('token expirado é recusado por padrão', () => {
    const token = adminSession.assinar(ADMIN);
    const expirado = jwtRs256.sign({ aud: 'admin', adminId: 'adm-1' }, { expiresIn: -10 });
    assert.doesNotThrow(() => adminSession.verificar(token));
    assert.throws(() => adminSession.verificar(expirado), /jwt expired/);
  });

  test('token expirado passa com ignoreExpiration (caminho do /refresh)', () => {
    const expirado = jwtRs256.sign({ aud: 'admin', adminId: 'adm-1' }, { expiresIn: -10 });
    const payload = adminSession.verificar(expirado, { ignoreExpiration: true });
    assert.equal(payload.adminId, 'adm-1');
  });

  test('assinatura adulterada é recusada', () => {
    const token = adminSession.assinar(ADMIN);
    assert.throws(() => adminSession.verificar(token.slice(0, -4) + 'AAAA'));
  });
});
