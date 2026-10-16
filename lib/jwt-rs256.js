// Assinatura/verificação de JWT em RS256 + JWKS.
//
// A plataforma assina os tokens de acesso com uma chave privada RSA e publica
// a pública em GET /.well-known/jwks.json. Studio e People verificam local com
// a pública (sem round-trip), como o People já faz hoje com o próprio segredo
// — a diferença é que agora ninguém além da plataforma re-assina nada, e a
// invalidação rápida vem do TTL (3h) + POST /auth/refresh.
//
// TTL 3h (2026-10-16, pedido explícito): nenhum dos 3 frontends (Studio/
// CRM/People) chama /auth/refresh proativamente — o token só é renovado se
// algo re-logar manualmente. Com TTL de 15min, qualquer sessão inativa por
// mais de 15min recebia 401 na próxima chamada e caía pro /login. 3h cobre
// um período de trabalho sem precisar relogar; invalidação continua rápida
// via tokenVersion (logout/troca de senha barra a renovação, não dá pra
// esperar o token expirar sozinho).
//
// Chaves via env `PLATFORM_JWT_PRIVATE_KEY` / `PLATFORM_JWT_PUBLIC_KEY` (PEM;
// SSM em produção). Sem elas — só dev/teste — um par efêmero é gerado no boot
// e um aviso é logado (mesma filosofia "provedor opcional em dev" do
// token-service.js).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ISSUER = process.env.PLATFORM_JWT_ISSUER || 'https://auth.kyvvo.com.br';
const ACCESS_TTL = process.env.PLATFORM_JWT_ACCESS_TTL || '3h';

// Aceita a chave em PEM cru OU em base64 do PEM. O env_file do compose (e o
// gen-env-from-ssm.sh, que recusa valor com quebra de linha) não carrega PEM
// multi-linha — então em produção os params SSM guardam `base64 -w0` do PEM.
function pemDeEnv(valor) {
  if (!valor) return valor;
  if (valor.includes('-----BEGIN')) return valor;
  return Buffer.from(valor, 'base64').toString('utf8');
}

function carregarChaves() {
  const privPem = pemDeEnv(process.env.PLATFORM_JWT_PRIVATE_KEY);
  const pubPem = pemDeEnv(process.env.PLATFORM_JWT_PUBLIC_KEY);

  if (privPem && pubPem) {
    return {
      privateKey: crypto.createPrivateKey(privPem),
      publicKey: crypto.createPublicKey(pubPem),
      efemera: false,
    };
  }

  if (privPem || pubPem) {
    throw new Error(
      'jwt-rs256: defina PLATFORM_JWT_PRIVATE_KEY e PLATFORM_JWT_PUBLIC_KEY juntas (só uma foi passada)'
    );
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  console.warn(
    '[jwt-rs256] PLATFORM_JWT_*_KEY ausentes — par RSA efêmero gerado no boot. ' +
      'Tokens não sobrevivem a um restart. Configure as chaves fora de dev.'
  );
  return { privateKey, publicKey, efemera: true };
}

const { privateKey, publicKey, efemera } = carregarChaves();

// `kid` derivado do thumbprint da chave pública (RFC 7638) — estável pra uma
// mesma chave, muda sozinho numa rotação, então JWKS e header do token nunca
// ficam dessincronizados.
const jwkPublica = publicKey.export({ format: 'jwk' });
const KID = crypto
  .createHash('sha256')
  .update(JSON.stringify({ e: jwkPublica.e, kty: jwkPublica.kty, n: jwkPublica.n }))
  .digest('base64url')
  .slice(0, 16);

// Assina um token de acesso. `expiresIn` default 3h; o call site do login
// não passa nada, o /refresh também usa o default.
function sign(claims, { expiresIn = ACCESS_TTL } = {}) {
  return jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    expiresIn,
    issuer: ISSUER,
    keyid: KID,
  });
}

// Verifica assinatura + `iss` + expiração. `ignoreExpiration` só pro /refresh,
// que aceita um access token vencido há pouco pra emitir um novo par.
function verify(token, { ignoreExpiration = false } = {}) {
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    ignoreExpiration,
  });
}

// JWKS servido em /.well-known/jwks.json.
function jwks() {
  return {
    keys: [{ ...jwkPublica, kid: KID, use: 'sig', alg: 'RS256' }],
  };
}

module.exports = { sign, verify, jwks, pemDeEnv, ISSUER, ACCESS_TTL, KID, efemera };
