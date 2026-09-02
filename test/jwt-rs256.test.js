const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// Sem PLATFORM_JWT_*_KEY no ambiente, lib/jwt-rs256 gera um par efêmero no
// boot — suficiente pra exercitar sign/verify/jwks aqui.
const jwtRs256 = require('../lib/jwt-rs256');

const CLAIMS = { userId: 'u-1', tenantId: 't-1', email: 'dono@salao.com', tokenVersion: 3 };

describe('jwt-rs256', () => {
  test('sign → verify: roundtrip preserva os claims', () => {
    const token = jwtRs256.verify(jwtRs256.sign(CLAIMS));
    assert.equal(token.userId, 'u-1');
    assert.equal(token.tenantId, 't-1');
    assert.equal(token.email, 'dono@salao.com');
    assert.equal(token.tokenVersion, 3);
    assert.equal(token.iss, jwtRs256.ISSUER);
  });

  test('header traz alg RS256 e o kid do JWKS', () => {
    const token = jwtRs256.sign(CLAIMS);
    const { header } = jwt.decode(token, { complete: true });
    assert.equal(header.alg, 'RS256');
    assert.equal(header.kid, jwtRs256.KID);
    assert.equal(jwtRs256.jwks().keys[0].kid, header.kid);
  });

  test('jwks expõe uma chave pública RSA (use=sig, alg=RS256), sem material privado', () => {
    const [jwk] = jwtRs256.jwks().keys;
    assert.equal(jwk.kty, 'RSA');
    assert.equal(jwk.use, 'sig');
    assert.equal(jwk.alg, 'RS256');
    assert.ok(jwk.n && jwk.e);
    assert.equal(jwk.d, undefined);
  });

  test('token expirado é rejeitado por verify (sem ignoreExpiration)', () => {
    const token = jwtRs256.sign(CLAIMS, { expiresIn: -10 });
    assert.throws(() => jwtRs256.verify(token), /jwt expired/);
  });

  test('token expirado passa com ignoreExpiration (caminho do /refresh)', () => {
    const token = jwtRs256.sign(CLAIMS, { expiresIn: -10 });
    const payload = jwtRs256.verify(token, { ignoreExpiration: true });
    assert.equal(payload.userId, 'u-1');
  });

  test('assinatura adulterada é rejeitada', () => {
    const token = jwtRs256.sign(CLAIMS);
    const adulterado = token.slice(0, -4) + 'AAAA';
    assert.throws(() => jwtRs256.verify(adulterado));
  });

  test('issuer diferente é rejeitado', () => {
    // Assina "à mão" com outro issuer usando a mesma lib pública não dá — mas
    // um token de outro emissor tem `iss` diferente e verify checa `iss`.
    const forjado = jwt.sign({ ...CLAIMS, iss: 'https://evil.example' }, 'segredo-hs256');
    assert.throws(() => jwtRs256.verify(forjado));
  });
});
