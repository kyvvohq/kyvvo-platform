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
- `src/lib/useFetch.ts` — GET declarativo (`{dados, carregando, erro,
  recarregar}`); `src/lib/format.ts`, `src/lib/template.ts`.
- `src/lib/nav.ts` — navegação de 1º nível + permissão exigida por item.
- `src/components/` — `Shell` (Sidebar + Topbar), `GlobalSearch`, `Estado`
  (loading/erro), `EmptyState`, `StatusBadge`, `ConfirmModal`, `RequirePerm`,
  `*Tabs` (sub-abas por módulo).
- `src/pages/` — `Login`, `Overview`, e uma pasta por área:
  `clientes/` (lista + 360° + ações + entitlements + billing),
  `usuarios/`, `produtos/`, `plataforma/` (planos + assinaturas),
  `whatsapp/` (números + eventos), `campanhas/` (templates + editor),
  `sistema/` (auditoria + flags + admins).

## Pontos de extensão

- **Nova área no menu**: item em `src/lib/nav.ts` (com `perms`) → rota em
  `src/App.tsx` (envolta em `<RequirePerm>`) → `src/pages/<area>/`.
- **Novo endpoint admin**: `../routes/admin/<x>.js` exportando
  `register…Routes(fastify, pool)`, gateado por
  `[fastify.authenticateAdmin, fastify.requirePermission('<perm>')]`, e
  registrado em `../index.js`. Escrita sensível → transação + `registrarAuditoria`.
- **Nova permissão/papel**: migration nova em `../db/` alterando
  `admin_permissions` / `admin_role_permissions` (o catálogo é seed, não é
  editável pela UI).
- **Painel de produto na 360°**: cada produto expõe
  `GET /admin-adapter/tenants/:id` (ver `kyvvo-studio`); `lib/product-adapters.js`
  no platform faz o fan-out. Adicionar um produto = uma linha na lista `ADAPTERS`.
- **Design System**: só via `/ds/*` (o platform serve
  `@kyvvohq/design-system`); a SPA não importa o pacote.
