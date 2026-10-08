const { Pool } = require('pg');

// kyvvo-people usa um banco Postgres PRÓPRIO (`kyvvo_people`), não o
// `railway` que platform/studio compartilham (confirmado na EC2:
// PEOPLE_DATABASE_URL != DATABASE_URL, mesmo host `postgres`, banco
// diferente) — por isso aqui é uma connection pool separada, em vez de só
// trocar o search_path como `lib/db.js` faz pro Studio. Sem schema especial:
// o People nunca usou um (mesmo padrão do `kyvvo-people/lib/db.js`).
const peoplePool = new Pool({
  connectionString: process.env.PEOPLE_DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = { peoplePool };
