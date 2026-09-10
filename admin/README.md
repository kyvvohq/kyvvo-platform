# kyvvo-admin (SPA)

Portal admin da Kyvvo — o **Control Center da plataforma**. SPA Vite + React +
TS, servida estática pelo `kyvvo-platform` em `/admin` (`@fastify/static` +
fallback de SPA no `../index.js`).

Arquitetura e plano de fases: `../docs/admin-portal/arquitetura-e-plano.md`.

## Dev

```sh
# terminal 1 — o serviço (API + /ds/)
cd ..            # raiz do kyvvo-platform
npm install
export DATABASE_URL=postgres://…   # um Postgres com as migrations aplicadas
npm start                          # :3003

# terminal 2 — a SPA com HMR
cd admin
npm install
npm run dev                        # :5273, proxy de /admin/api e /ds pro :3003
```

Abre `http://localhost:5273/admin/`. Precisa de um `admin_users` no banco —
crie com `node ../scripts/criar-admin.js --email … --senha … --papel superadmin`.

## Build

```sh
npm run build      # tsc -b && vite build  →  admin/dist/
```

`admin/dist/` **não é versionado** — é gerado no deploy (workflow do
`kyvvo-platform`), com `base: '/admin/'` pros assets resolverem sob o prefixo.
Enquanto `admin/dist/index.html` não existe, o `../index.js` nem registra a
rota `/admin` — o serviço segue sendo só a API.

## Estrutura

- `src/lib/api.ts` — cliente da Admin API: Bearer, refresh silencioso no 401,
  logout + redirect ao falhar.
- `src/lib/auth.tsx` — `AuthProvider` / `useAuth` (`admin`, `entrar`, `sair`,
  `pode(...perms)`).
- `src/lib/nav.ts` — navegação de 1º nível + permissão exigida por item.
- `src/components/` — `Shell` (Sidebar + Topbar), `GlobalSearch` (stub),
  `EmptyState`.
- `src/pages/` — `Login`, `Overview` (KPIs placeholder), `Placeholder` (telas
  das áreas do MVP até cada fase chegar).
