// Sessão do Kyvvo Admin — JWT RS256 com `aud: "admin"`.
//
// Reusa a mesma chave privada / JWKS do serviço (lib/jwt-rs256.js): o portal
// admin não tem infra de chave própria. O que separa um token de admin de um
// token de tenant é a claim `aud` — `verificar()` recusa qualquer token sem
// `aud === "admin"`, então um access token de salão nunca é aceito numa rota
// `/admin/api/*` e vice-versa.
//
// TTL curto (30 min, um pouco acima dos 15 min do tenant por ser ferramenta
// interna) + POST /admin/api/auth/refresh, mesma filosofia do /api/auth/refresh.

const jwtRs256 = require('./jwt-rs256');

const AUD = 'admin';
const TTL = process.env.ADMIN_JWT_ACCESS_TTL || '30m';

function assinar(admin) {
  return jwtRs256.sign(
    { aud: AUD, adminId: admin.id, email: admin.email, nome: admin.nome || null },
    { expiresIn: TTL }
  );
}

// `ignoreExpiration` só pro /refresh, que aceita um token vencido há pouco.
function verificar(token, { ignoreExpiration = false } = {}) {
  const payload = jwtRs256.verify(token, { ignoreExpiration });
  if (payload.aud !== AUD) {
    const err = new Error('Token não é de admin (aud inválida).');
    err.code = 'AUD_INVALIDA';
    throw err;
  }
  return payload;
}

module.exports = { assinar, verificar, AUD, TTL };
