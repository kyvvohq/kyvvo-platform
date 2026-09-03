const path = require('path');
const { Pool } = require('pg');
const { migrar: migrarBase } = require('@kyvvohq/db-migrate');

// Todo o schema do serviço vive em `platform` (ver db/001_schema.sql). O
// código portado de server/panel usa nomes de tabela sem qualificar
// (`FROM usuarios`), então o search_path da conexão resolve pra platform
// primeiro. Em produção o mesmo efeito vem de
// `ALTER ROLE platform_app SET search_path = platform, public`; aqui garante
// o comportamento em dev/teste e em qualquer role.
//
// SEM espaço entre os itens: no parâmetro de conexão `options` do libpq o
// espaço separa argumentos, então `search_path=platform, public` vira
// `search_path=platform,` (inválido) + um arg solto `public`.
const SEARCH_PATH = (process.env.DB_SEARCH_PATH || 'platform,public').replace(/\s+/g, '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  options: `-c search_path=${SEARCH_PATH}`,
});

// Assinatura local sem args (call site: `await migrar()` no index.js) —
// mesma tabela de controle `_migrations` e mensagens `[db] ...` do runner.
function migrar() {
  return migrarBase({ pool, dir: path.join(__dirname, '..', 'db') });
}

module.exports = { pool, migrar };
