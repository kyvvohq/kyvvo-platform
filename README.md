# kyvvo-platform

Serviço de **identidade, sessão, entitlements e billing** compartilhado pelos
produtos Kyvvo (Studio, People). Tira login/logout/recuperação de senha,
verificação de sessão (JWT) e cobrança de dentro de `kyvvo/server/panel` e põe
num serviço próprio — o Studio passa a ser cliente disto, como o People já é.

Fase **P3** do runbook de migração (`kyvvohq` · artifact "Kyvvo Migration
Runbook"). Ordem: P0–P2 feitos (pacotes `@kyvvohq/*`, CI/CD, secrets no SSM,
infra em `kyvvohq/kyvvo-infra`).

## Estado atual — leva 1 (esqueleto + sessão + billing), greenfield

**Nada em produção usa isto ainda.** Nada em `kyvvo`/`kyvvo-people` mudou;
nada deploya (o `deploy.yml` está dormente).

| Área | O quê |
|---|---|
| Sessão | `POST /api/auth/{login,logout,esqueci-senha,redefinir-senha,register,verify-token,resend-token,refresh}`, `GET /api/auth/people/acesso` — portado verbatim de `kyvvo/server/panel/routes/auth.js` (menos EOL; `register` só troca `fastify.jwt.sign`→RS256) |
| JWT | RS256 (`lib/jwt-rs256.js`): assina com chave privada, `GET /.well-known/jwks.json`, access TTL 15 min, `POST /api/auth/refresh` |
| Guards | `authenticate` / `requireModulo` / `requireAdmin` — portados de `server/panel/index.js`, só a verificação do token virou RS256 local |
| Billing (Studio) | `GET /api/pagamentos[/status]`, `POST /api/pagamentos/cadastrar`, `PATCH /api/pagamentos/plano`, `DELETE /api/pagamentos/assinatura`, `POST /webhooks/asaas` — cópia byte-a-byte de `server/panel/routes/pagamentos.js` + `lib/{planos,pagamentos}.js` + `asaas-service.js` (= `@kyvvohq/asaas`). Corte concluído (nginx roteia `studio.kyvvo.com.br` pra cá, código antigo já removido do Studio) |
| Billing (People) | `GET /people/api/pagamentos[/planos]`, `POST /people/api/pagamentos/cadastrar`, `PATCH /people/api/pagamentos/plano`, `DELETE /people/api/pagamentos/assinatura`, `POST /people/webhooks/asaas` — portado de `kyvvo-people/index.js`, mas o People guarda assinatura numa tabela própria (`assinaturas`, banco `kyvvo_people` separado — nunca esteve no schema `platform`) em vez de colunas em `tenants`; por isso usa uma 2ª connection pool (`PEOPLE_DATABASE_URL`, `lib/db-people.js`) e código próprio (`routes/pagamentos-people.js`) em vez de reaproveitar o do Studio |
| Entitlements | `GET /entitlements/:tenantId` (JWT do próprio tenant), `GET /plans?produto=studio\|people`, `GET /health` |
| Schema | `db/001_schema.sql` (identidade/sessão) + `db/002_billing.sql` (colunas asaas_*/endereco_*/cpf_cnpj/segmento*/onboarding de `tenants`, `segmentos`, `consentimentos_cadastro`) — schema `platform`, via `@kyvvohq/db-migrate` |

Verificado contra Postgres real (PGlite): migrations aplicam limpo + idempotentes;
toda query de `routes/*` e `lib/*` casa colunas; `register` + webhook + PATCH de
plano rodam. `build().ready()` registra as 17 rotas sem conflito. 31 testes
unitários (RS256/trial-conta/whatsapp) verdes sem DB.

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
| `DB_SEARCH_PATH` | default `platform,public` |
| `PEOPLE_DATABASE_URL` | banco **próprio** do kyvvo-people (`kyvvo_people`, mesmo host Postgres mas banco separado — nunca esteve no schema `platform`) — usado só pelas rotas `/people/api/pagamentos/*`/`/people/webhooks/asaas` (`lib/db-people.js`), que leem/escrevem a tabela `assinaturas` de lá |
| `PLATFORM_JWT_PRIVATE_KEY` / `PLATFORM_JWT_PUBLIC_KEY` | par RS256 — PEM cru **ou** `base64 -w0` do PEM (em prod é base64, porque `env_file`/`gen-env-from-ssm.sh` não aceitam valor multi-linha) |
| `PLATFORM_JWT_ISSUER` | default `https://auth.kyvvo.com.br` |
| `PLATFORM_JWT_ACCESS_TTL` | default `15m` |
| `EMAIL_PROVIDER` | `ses` \| `resend` \| `log`. Sem valor: `resend` se houver `RESEND_API_KEY`, senão `log` |
| `SES_REGION` / `SES_CONFIGURATION_SET` | SES (default `us-east-1`); credenciais pela role da instância EC2 |
| `SES_SNS_TOPIC_ARN` | tópico SNS aceito em `/webhook/ses` (sem isso, o webhook recusa tudo) |
| `INTERNAL_EMAIL_TOKENS` | `studio:tok,people:tok,crm:tok,admin:tok` — token por produto pro `/internal/email/send` |
| `EMAIL_FROM` / `EMAIL_FROM_<PRODUTO>` | remetente (default `Kyvvo <no-reply@kyvvo.com.br>`; só domínio `kyvvo.com.br`) |
| `RESEND_API_KEY` / `RESEND_FROM` | fallback da transição pro SES (opcional) |
| `META_WHATSAPP_TOKEN` / `META_PHONE_NUMBER_ID` | WhatsApp dos códigos (opcional) |
| `ASAAS_ENV` / `ASAAS_API_KEY_*` / `ASAAS_WEBHOOK_TOKEN` | billing (`@kyvvohq/asaas`); sem chave = modo log |
| `CRM_CREDITOS_URL` / `CRM_CREDITOS_INTERNAL_TOKEN` | compra de créditos de WhatsApp do CRM (`routes/pagamentos-crm.js`): URL pública do endpoint do CRM que credita o saldo + segredo compartilhado (mesmo padrão de `PLATFORM_PAGAMENTOS_TOKEN`, só que na direção contrária — platform chamando o CRM) |
| `PORT` | default `3003` |

## Deploy (quando ativar)

Mesmo padrão dos outros apps Kyvvo: imagem `node:20-alpine` crua + bind mount
+ `command: npm install && node index.js`, sem build. `deploy.yml` faz scp pra
`/opt/kyvvo/platform` + `gen-env-from-ssm.sh` + `docker compose up -d --force-recreate
platform`. Falta: DNS `auth.kyvvo.com.br`, bloco nginx, serviço no compose,
params no SSM, secrets `EC2_*` + `NPM_PACKAGES_TOKEN` neste repo.

## Serviço de e-mail (SES)

Todos os produtos mandam e-mail pelo platform — um remetente verificado, um
log (`platform.email_envios`) e uma lista de supressão
(`platform.email_supressoes`).

```
POST http://platform:3003/internal/email/send
X-Internal-Token: <token do produto em INTERNAL_EMAIL_TOKENS>
{ "to": "a@b.com" | ["a@b.com", ...], "subject": "...", "html": "...", "text": "...",
  "replyTo": "...", "fromName": "Salão da Ana", "tag": "convite_equipe" }
-> 200 { ok: true, resultados: [{ to, status: "enviado", messageId }] }
   400 payload inválido · 401 token · 502 algum destinatário falhou/suprimido
```

O produto é deduzido do token (não do corpo). `fromName` troca só o nome de
exibição; o endereço é sempre `EMAIL_FROM_<PRODUTO>`/`EMAIL_FROM`.

`POST /webhook/ses` recebe os eventos do configuration set via SNS (assinatura
verificada, `TopicArn` == `SES_SNS_TOPIC_ARN`): bounce permanente e reclamação
entram na supressão; entrega/bounce/reclamação atualizam `email_envios.status`.
