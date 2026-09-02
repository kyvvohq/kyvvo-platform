# kyvvo-platform

Serviço de **identidade, sessão, entitlements e billing** compartilhado pelos
produtos Kyvvo (Studio, People). Tira login/logout/recuperação de senha,
verificação de sessão (JWT) e cobrança de dentro de `kyvvo/server/panel` e põe
num serviço próprio — o Studio passa a ser cliente disto, como o People já é.

Fase **P3** do runbook de migração (`kyvvohq` · artifact "Kyvvo Migration
Runbook"). Ordem: P0–P2 feitos (pacotes `@kyvvohq/*`, CI/CD, secrets no SSM,
infra em `kyvvohq/kyvvo-infra`).

## Estado atual — leva 1a (esqueleto + sessão)

Greenfield. **Nada em produção usa isto ainda.** Nada em `kyvvo`/`kyvvo-people`
mudou; nada deploya (o `deploy.yml` está dormente).

Entregue:

| Área | O quê |
|---|---|
| Sessão | `POST /api/auth/{login,logout,esqueci-senha,redefinir-senha,verify-token,resend-token,refresh}`, `GET /api/auth/people/acesso` — portado verbatim de `kyvvo/server/panel/routes/auth.js` (menos EOL) |
| JWT | RS256 (`lib/jwt-rs256.js`): assina com chave privada, `GET /.well-known/jwks.json`, access TTL 15 min, `POST /api/auth/refresh` |
| Guards | `authenticate` / `requireModulo` / `requireAdmin` — portados de `server/panel/index.js`, só a verificação do token virou RS256 local |
| Entitlements | `GET /entitlements/:tenantId` (JWT do próprio tenant), `GET /plans?produto=studio\|people`, `GET /health` |
| Schema | `db/001_schema.sql` — schema `platform` consolidado (tenants, usuarios, tokens_validacao, eventos_analytics, configuracoes_sistema, modulos, tenant_modulos, planos, plano_features, plano_limites), via `@kyvvohq/db-migrate` |

**Ainda não portado** (próxima leva): `POST /api/auth/register` (arrasta
segmentos/consentimentos/onboarding) e `routes/pagamentos.js` +
colunas de billing de `tenants` + `assinaturas`.

## Rodar local

```sh
npm install                      # precisa de NPM_PACKAGES_TOKEN pros @kyvvohq/*
export DATABASE_URL=postgres://…  # um Postgres descartável
npm start                        # aplica migrations e sobe na :3003
```

Sem `PLATFORM_JWT_PRIVATE_KEY` / `PLATFORM_JWT_PUBLIC_KEY`, um par RSA efêmero
é gerado no boot (só dev — tokens não sobrevivem a restart).

```sh
npm test    # funções puras + crypto; só precisa de `jsonwebtoken`, sem DB
```

## Variáveis de ambiente

| Var | Uso |
|---|---|
| `DATABASE_URL` | Postgres (schema `platform`) |
| `DB_SEARCH_PATH` | default `platform, public` |
| `PLATFORM_JWT_PRIVATE_KEY` / `PLATFORM_JWT_PUBLIC_KEY` | par RS256 em PEM (SSM em prod) |
| `PLATFORM_JWT_ISSUER` | default `https://auth.kyvvo.com.br` |
| `PLATFORM_JWT_ACCESS_TTL` | default `15m` |
| `RESEND_API_KEY` / `RESEND_FROM` | e-mail dos códigos de verificação (opcional; sem isso, modo log) |
| `META_WHATSAPP_TOKEN` / `META_PHONE_NUMBER_ID` | WhatsApp dos códigos (opcional) |
| `ASAAS_*` | billing (próxima leva) |
| `PORT` | default `3003` |

## Deploy (quando ativar)

Mesmo padrão dos outros apps Kyvvo: imagem `node:20-alpine` crua + bind mount
+ `command: npm install && node index.js`, sem build. `deploy.yml` faz scp pra
`/opt/platform` + `gen-env-from-ssm.sh` + `docker compose up -d --force-recreate
platform`. Falta: DNS `auth.kyvvo.com.br`, bloco nginx, serviço no compose,
params no SSM, secrets `EC2_*` + `NPM_PACKAGES_TOKEN` neste repo.
