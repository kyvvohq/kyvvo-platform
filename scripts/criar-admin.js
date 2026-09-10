#!/usr/bin/env node
// Cria (ou atualiza a senha de) um admin do portal e atribui um papel.
//
//   node scripts/criar-admin.js --email x@kyvvo.com.br --senha '...' \
//     [--nome 'Fulano'] [--papel superadmin]
//
// Idempotente: rodar de novo com o mesmo e-mail troca a senha/nome e
// garante o papel. Usado pro primeiro admin (local e no corte em produção)
// e sempre que precisar provisionar mais gente do time.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (arg('email') || '').toLowerCase().trim();
  const senha = arg('senha') || '';
  const nome = arg('nome') || null;
  const papel = arg('papel') || 'superadmin';

  if (!email || !senha) {
    console.error('uso: node scripts/criar-admin.js --email <e-mail> --senha <senha> [--nome <nome>] [--papel <chave>]');
    process.exit(1);
  }
  if (senha.length < 10) {
    console.error('senha muito curta (mínimo 10 caracteres).');
    process.exit(1);
  }

  const searchPath = (process.env.DB_SEARCH_PATH || 'platform,public').replace(/\s+/g, '');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
    options: `-c search_path=${searchPath}`,
  });

  try {
    const { rows: papelRows } = await pool.query('SELECT chave FROM admin_roles WHERE chave = $1', [papel]);
    if (papelRows.length === 0) {
      const { rows: todos } = await pool.query('SELECT chave FROM admin_roles ORDER BY chave');
      console.error(`papel "${papel}" não existe. Disponíveis: ${todos.map((r) => r.chave).join(', ')}`);
      process.exit(1);
    }

    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      `INSERT INTO admin_users (email, senha_hash, nome)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, nome = COALESCE(EXCLUDED.nome, admin_users.nome)
       RETURNING id, (xmax = 0) AS criado`,
      [email, hash, nome]
    );
    const { id, criado } = rows[0];

    await pool.query(
      'INSERT INTO admin_user_roles (admin_id, role_chave) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, papel]
    );

    console.log(`${criado ? 'criado' : 'atualizado'}: ${email} (${id}) — papel ${papel}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
