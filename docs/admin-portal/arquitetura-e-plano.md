# Kyvvo Admin — Arquitetura e Plano de Execução

> Base: spec "Kyvvo Admin Portal — Especificação para Agente de IA" v1.0.
> Este documento traduz a spec pro contexto real da Kyvvo (polyrepo, platform,
> Design System) e define a ordem de construção.

## 0. Decisões (2026-09-10)

| # | Decisão | Valor |
|---|---|---|
| 1 | Casa do portal | **`kyvvo-platform`** (mesmo repo/serviço, não repo novo) |
| 2 | Backend | **Admin API própria no platform** (RBAC + auditoria) serve o compartilhado; cada produto expõe um **adapter** que a BFF chama server-to-server pro específico dele |
| 3 | Identidade/sessão | Admin **assume o `kyvvo-platform`**; a Fase 2 do platform acelera (billing cutover entra no caminho) |
| 4 | Frontend | **Vite + React SPA**, servido pelo Fastify do platform (`@fastify/static` em `/admin`) — um deploy só, build step |
| 5 | Escopo do primeiro corte | **MVP enxuto e operacional** (§7) |

Identidade/RBAC/auditoria de admin **migram pro `platform`** — o `kyvvo_admins`
que hoje vive no schema `public` do Studio vem junto (poucas linhas).

---

## 1. Topologia

```
                 admin.kyvvo.com.br
                        │   nginx  (hoje → :3001 studio; no cutover → :3003)
                        ▼
        ┌───────────────────────────────────────────┐
        │  kyvvo-platform   (Fastify :3003)         │
        │                                           │
        │  /admin              SPA estática         │  Vite build → dist/,
        │                     (@fastify/static)     │  fallback SPA no index.html
        │                                           │
        │  /admin/api/*        Admin API            │  RBAC por permissão
        │    ├─ platform-native                     │  + AuditEvent em toda escrita
        │    │    orgs · users · plans · subs ·     │
        │    │    billing · entitlements ·          │
        │    │    whatsapp assets · templates ·     │
        │    │    campaigns · audit · flags · search│
        │    └─ BFF fan-out ──────────┐             │
        │                             │             │
        │  /api/auth/*  (existe; +aud:"admin")      │
        │  /.well-known/jwks.json (existe)          │
        └─────────────────────────────┼─────────────┘
                                      │ server-to-server, contrato próprio
                    ┌─────────────────┼───────────────────┐
                    ▼                 ▼                   ▼
             kyvvo-studio       kyvvo-people        (Leads / CRM
          /admin-adapter/…   /admin-adapter/…       quando existirem)
          agenda, profis-    vagas, candidatos,
          sionais, unidades  avaliações
          uso/consumo
```

- **Platform-native**: tudo que já é (ou passa a ser) entidade da plataforma —
  não replica regra de negócio de produto.
- **Adapter de produto**: endpoint pequeno, majoritariamente leitura, contrato
  versionado. Nunca o frontend fala com banco de produto; nunca a Admin API
  faz `SELECT` no banco de outro produto — só HTTP no adapter.
- **Sem big-bang**: o admin atual do Studio segue no ar até haver parity. O
  cutover é `admin.kyvvo.com.br` no nginx (`:3001` → `:3003`) + PR removendo
  `server/panel/public/admin/*` e `routes/admin-*.js` do `kyvvo-studio`.

---

## 2. Identidade de admin & RBAC

Migração `db/004_admin_rbac_audit.sql` (schema `platform`):

| Tabela | Papel |
|---|---|
| `admin_users` | migra de `kyvvo_admins` (Studio): id, email, senha_hash, nome, ativo, criado_em |
| `admin_roles` | superadmin, suporte, billing, whatsapp_ops, read_only (seed) |
| `admin_permissions` | `clientes:read`, `clientes:suspend`, `plano:alterar`, `whatsapp:read`, `whatsapp:disable`, `template:write`, `flag:write`, `auditoria:read`, … |
| `admin_role_permissions` | N↔N |
| `admin_user_roles` | N↔N |

- **Sessão**: reusa `lib/jwt-rs256` com `aud: "admin"`, TTL curto + `POST
  /api/auth/refresh`. Claims: `adminId`, `email`, `roles[]`, `perms[]`.
  `POST /admin/api/auth/login` (bcrypt sobre `admin_users`), separado do login
  de tenant.
- **Guard**: `requirePermission('clientes:suspend')` — nega com 403 e o item
  some do menu (menor privilégio, spec §13/§19).
- FKs órfãs: colunas do Studio que apontam pra `kyvvo_admins` (`029`, `037`,
  `044`, `046`) viram `uuid` solto sem FK — mesmo movimento que o platform já
  fez com `planos.atualizado_por`.
- **Primeiro admin**: `scripts/criar-admin.js` (idempotente). No corte (Fase 5),
  as linhas reais de `kyvvo_admins` migram direto — mesmo `bcryptjs`, o hash é
  copiável (`INSERT ... SELECT` cross-db ou dump), sem reset de senha.

---

## 3. Auditoria

`platform.audit_events`: `id`, `ator_admin_id`, `acao`, `entidade_tipo`,
`entidade_id`, `tenant_id`, `valor_antes jsonb`, `valor_depois jsonb`, `ip`,
`user_agent`, `criado_em`.

- Helper `registrarAuditoria(request, {...})` chamado por **toda** rota de
  escrita sensível (spec §6: ator, tenant, ação, timestamp, antes/depois).
- Viewer em **Sistema › Auditoria** — filtro por ator / entidade / tenant /
  período.

---

## 4. Modelo de dados novo no platform

Reusa o que já existe (`tenants`, `usuarios`, `planos`, `modulos`,
`tenant_modulos`, `plano_limites`, `configuracoes_sistema`, `eventos_analytics`
+ colunas de billing em `tenants`). Adiciona:

**WhatsApp** (`db/005_whatsapp_assets.sql`)
- `whatsapp_wabas` — `waba_id`, `tenant_id`, `status`, `criado_em`
- `whatsapp_phone_numbers` — `phone_number_id`, `waba_id`, `tenant_id`,
  `produto`, `display_number`, `status`, `quality_rating`, `ultima_atividade`
- `whatsapp_webhook_events` — `tipo`, `phone_number_id`, `payload jsonb`,
  `recebido_em`, `erro` (o `routes/webhook-whatsapp.js` já recebe; passa a
  persistir)
- `whatsapp_message_status` — `message_id`, `phone_number_id`, `status`,
  `erro_codigo`, `ts` (deriva dos eventos)

**Messaging** (`db/006_messaging.sql`)
- `message_templates` — `id`, `produto`, `nome_interno`, `categoria`, `idioma`,
  `corpo`, `variaveis jsonb`, `exemplo jsonb`, `descricao_uso`, `estado`
  (rascunho/enviado/em_analise/aprovado/rejeitado/arquivado), `meta_status`,
  `meta_sync_em`, `versao`, `autor_admin_id`, `criado_em`
- `message_template_versions` — histórico + autor
- `campaigns`, `campaign_results` — **modeladas, MVP não popula** (shell/mock;
  spec §10: não acoplar UI ao dispatch)

**Governança** (`db/004`, acima)
- `feature_flags` — `chave`, `escopo` (`global`|`produto`|`tenant`), `alvo`,
  `valor`, `atualizado_por`, `atualizado_em`

Camadas seguem a spec §15 (Platform / WhatsApp / Messaging / Product domains /
Governança). Product domains ficam **no adapter de cada produto**, não aqui.

---

## 5. Frontend (SPA)

- **Vite + React + TypeScript**, React Router, TanStack Query (server state).
  Sem lib de UI pesada.
- **`@kyvvohq/design-system`** pros tokens/CSS/componentes. Layout shell =
  sidebar + topbar + **busca global fixa** (spec §14/§17).
- **Padrão de página**: `PageHeader` + filtros + tabela + paginação + **drawer**
  de detalhe. Tabelas ≤ 6–7 colunas primárias; o resto no drawer; colunas
  configuráveis onde fizer sentido.
- **Estados obrigatórios** em toda tela principal: `loading` / `empty` /
  `error` / `success` (spec §18.6).
- Build → `dist/` servido por `@fastify/static` em `/admin`; rota coringa
  devolve `index.html` (SPA routing).
- **Auth**: login → token `aud:admin` no storage; refresh silencioso; `401` →
  tela de login. Nav e rotas renderizam só o que a permissão permite.

---

## 6. Busca global

`GET /admin/api/search?q=` → federada, cada hit `{tipo, id, label, sublabel, href}`:

| Entrada | Encontra |
|---|---|
| Empresa | tenant, usuários, produtos, assinatura, WhatsApp, campanhas |
| Usuário | empresas, permissões, atividade |
| Telefone | número, empresa, WABA, atividade |
| WABA / Phone Number ID | ativo, empresa, status, logs |
| Template | template, produto, status, campanhas |
| Campaign ID | campanha, métricas, logs, tenant |

**MVP**: empresas + usuários + telefones + `phone_number_id`. O resto entra
quando as entidades existirem.

---

## 7. Escopo do MVP — enxuto e operacional

**Entra:**
- Shell + nav gateada por permissão + busca global (empresas/usuários/telefones/PNID)
- RBAC (papéis + permissões) + login admin + spine de `AuditEvent` + viewer
- **Visão geral**: KPIs derivados do que já existe (clientes, produtos ativos,
  WhatsApp básico, IA/uso) — todos clicáveis pro filtro correspondente
- **Clientes**: Empresas (lista + filtros) + Detalhe 360° (platform + adapter
  Studio) + Usuários (busca global)
- **Produtos / Entitlements**: ver e alternar `modulos`/entitlements por tenant
  (já há base em `044_modulos_gestao_admin.sql` no Studio)
- **Plataforma**: catálogo de Planos (existe) + Assinaturas/Billing (**leitura**
  dos dados Asaas em `tenants`)
- **WhatsApp**: Números + WABAs + eventos de webhook (**leitura**) + saúde
  básica (quality rating)
- **Templates**: CRUD + estados + campos Meta (submissão à Meta pode começar
  _stubbed_)
- **Sistema**: Admins/Papéis, Auditoria, Feature Flags

**Só shell + mock:** Campanhas (sem dispatch real), Leads, CRM.

**Fica pra fase seguinte:** saúde de números com tendências/histórico,
relatórios de campanha reais, impersonar cliente, billing self-service pelo admin.

---

## 8. Plano de fases

### Fase 0 — Fundação (platform)

**0a — backend (feito, PR `feat/admin-fase0-foundation`):**
- [x] `db/004_admin_rbac_audit.sql` — `admin_users`, `admin_roles`,
  `admin_permissions`, `admin_role_permissions`, `admin_user_roles`,
  `audit_events`, `feature_flags` + catálogo de papéis/permissões
- [x] `lib/admin-session.js` — JWT RS256 `aud:"admin"`, TTL 30m, reusa a
  chave/JWKS do serviço
- [x] `lib/admin-rbac.js` — `authenticateAdmin` (lookup-por-request, checa
  `ativo`, resolve papéis+perms) + `requirePermission('x:y')`
- [x] `routes/admin/auth.js` — `POST /admin/api/auth/{login,refresh}`,
  `GET /admin/api/auth/me`
- [x] `scripts/criar-admin.js` — provisiona admin (primeiro admin local e no
  corte; idempotente): `node scripts/criar-admin.js --email … --senha … [--papel superadmin]`
- [x] `index.js` — guards + rotas admin; `@fastify/static` em `/admin/`
  (dormente até `admin/dist` existir) + fallback de SPA
- [x] `test/admin-session.test.js`

**0b — SPA (feito, PR `feat/admin-fase0-spa`):**
- [x] `admin/` — Vite + React + TS; `vite.config` com `base:'/admin/'` e proxy
  de `/admin/api` + `/ds` pro `:3003` em dev
- [x] `/ds/` servido pelo platform (`@kyvvohq/design-system` como dep;
  `@fastify/static` com `decorateReply` só na 1ª registração); a SPA referencia
  `/ds/tokens.css` + `/ds/components.css` (mesmo padrão do Studio) — Vite deixa
  as URLs absolutas intactas
- [x] `src/lib/api.ts` (Bearer + refresh silencioso no 401 + logout/redirect),
  `src/lib/auth.tsx` (`useAuth`: `admin`, `entrar`, `sair`, `pode(...perms)`),
  `src/lib/nav.ts` (nav de 1º nível + permissão por item)
- [x] Shell: `Sidebar` (itens filtrados por `pode(...)`), `Topbar` (busca
  global stub + identidade + Sair), tela de `Login`
- [x] Páginas: `Overview` (KPIs placeholder + slot de alertas) + `Placeholder`
  gateado por permissão pras áreas do MVP (Clientes/Produtos/Plataforma/
  WhatsApp/Templates/Sistema)
- [x] `ci.yml`: job `admin-spa` (`npm ci && npm run build`, inclui `tsc`)
- [x] `deploy.yml`: build do SPA no runner + `admin/dist/**` no scp
  `source`/`paths` (o container em prod não builda nada)
- [x] `index.js`: `/admin` só registra se `admin/dist/index.html` existir

**Falta pra fechar a Fase 0 (operacional):**
- Deploy pra prod (merge do PR) e conferir `auth.kyvvo.com.br/admin/` no
  browser — login com o `admin@kyvvo.com.br` já criado.

### Fase 1 — Clientes 360°

**1a — Empresas + 360° (dados platform) (feito, PR `feat/admin-fase1-clientes`):**
- [x] `routes/admin/clientes.js` — `GET /admin/api/clientes` (busca +
  filtros status/plano/módulo/whatsapp + paginação; status derivado filtrado
  em memória), `/clientes/resumo` (KPIs), `/clientes/filtros` (catálogo),
  `/clientes/:id` (360°: identidade, plano+entitlements, billing, usuários,
  atividade; `produtos: []` até o adapter). Todas gateadas por
  `requirePermission('clientes:read')`.
- [x] SPA: `pages/clientes/Lista.tsx` (tabela + filtros na URL + paginação),
  `Detalhe.tsx` (360° em seções). `useFetch` (loading/erro), `Estado`,
  `StatusBadge`, `RequirePerm`, `lib/format.ts`.

**1b — product adapter (feito; PRs `kyvvo-studio#21` + `kyvvo-platform#16`):**
- [x] **Contrato**: `GET /admin-adapter/tenants/:id` → envelope
  `{ produto, rotulo, metricas: [{chave,rotulo,valor}], ultima_atividade }`.
  Auth server-to-server por `ADMIN_ADAPTER_TOKEN` (SSM `/kyvvo/studio/` +
  `/kyvvo/platform/`), **não** o JWT de admin.
- [x] `kyvvo-studio`: `server/panel/routes/admin-adapter.js` — contagens de
  serviços/profissionais/clientes/agendamentos. Sem token → 503.
- [x] `kyvvo-platform`: `lib/product-adapters.js` (`buscarPaineisProduto`,
  fan-out paralelo, timeout 5s, `{produto,_erro}` em falha, `[]` sem token) →
  `GET /admin/api/clientes/:id.produtos`. SPA renderiza a seção.
- [ ] **Passo CloudShell do Bruno**: `ADMIN_ADAPTER_TOKEN` no SSM (×2) +
  recriar `studio` e `platform`. Até lá `produtos: []` (seção mostra vazio).

**1b — resto (próximos PRs):**
- [ ] Usuários: busca global + organizações do usuário
- [ ] Busca global v1 (real): empresas/usuários/telefones/PNID
- [ ] Ações sensíveis (suspender/reativar/alterar plano) → confirmação +
  `AuditEvent` (`lib/auditoria.js`)

### Fase 2 — Produtos & Plataforma
- Entitlements/`modulos` por tenant (portar telas do `admin-configuracoes`)
- Planos: leitura + edição com **versionamento** (spec §12 — não alterar
  contrato existente retroativamente)
- Assinaturas / Billing: leitura
- **Billing cutover do platform (Fase 2 / Step 5b do runbook P3)** entra aqui:
  `/api/pagamentos/*` + `/webhooks/asaas` → `:3003`

### Fase 3 — WhatsApp & Templates
- `db/005` + `db/006`; `webhook-whatsapp.js` passa a **persistir** eventos/status
- Números / WABAs / saúde básica (leitura)
- Templates: CRUD + versões + estados + sync Meta (`stub` → real; validar antes
  o que `META_WHATSAPP_TOKEN` permite como Tech Provider)

### Fase 4 — Visão geral + Sistema + polish
- KPIs clicáveis na home
- Feature Flags (UI) + Auditoria (viewer) + Campanhas (shell/mock)
- Revisão de `loading`/`empty`/`error` em todas as telas
- Testes das áreas críticas; README de execução e extensão (spec §21)

### Fase 5 — Cutover
- Parity check vs admin atual do Studio
- Repontar `admin.kyvvo.com.br` no nginx: `:3001` → `:3003` (mirror em
  `kyvvo-infra`)
- PR de remoção no `kyvvo-studio`: `server/panel/public/admin/*` +
  `routes/admin-*.js` + testes `admin*.spec.js`
- `kyvvo_admins` → read-only, depois `drop`

---

## 9. Riscos / pontos de atenção

- **Não é big-bang.** Admin atual no ar até parity; cutover = nginx + PR de
  remoção. Rollback = repontar o nginx de volta.
- **Meta / Tech Provider.** Submeter template e ler _quality rating_ exigem
  escopo/credencial Meta — validar o que o token atual já permite **antes** de
  prometer as telas de WhatsApp cheias.
- **FKs de `kyvvo_admins` no Studio** (`029`, `037`, `044`, `046`): ao migrar a
  identidade, viram `uuid` solto — precedente já aplicado no platform.
- **Nenhum segredo** Meta/AWS/Asaas no browser — tudo pela Admin API (spec §16).
- **DS component layer é jovem.** Pode faltar componente (tabela densa, drawer).
  Decisão caso a caso: completar o DS ou fazer local e portar depois.
- **`@fastify/static` no platform** é dependência nova no serviço — hoje é API
  pura. Baixo risco (serve `dist/`), mas é a primeira vez que o platform tem
  frontend.

---

## 10. Entregáveis (spec §21)

Frontend SPA · Admin API + contratos de adapter · RBAC/permissões · Auditoria de
ações sensíveis · Mocks/fixtures · Testes das áreas críticas · README de execução,
estrutura e pontos de extensão.

---

## 11. Diretriz de produto (spec §22)

O Admin responde em segundos: **quem usa a Kyvvo · o que esse cliente usa · o
que está acontecendo.** Simples pra operação diária, sobre entidades e contratos
que suportam produto/serviço/canal novo sem redesign do portal.
