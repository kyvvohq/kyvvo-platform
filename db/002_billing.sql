-- Kyvvo Platform — leva 1b: colunas de billing + cadastro self-service.
--
-- Segue db/001_schema.sql. Adiciona a `platform.tenants` as colunas que
-- `routes/pagamentos.js` e `POST /api/auth/register` usam, e as duas tabelas
-- de apoio do cadastro (`segmentos`, `consentimentos_cadastro`).
--
-- Forma final das migrations de kyvvo/server/db: 018, 023, 026, 027, 032,
-- 035, 041, 050, 051. Mesmo objetivo do 001: `pg_dump --schema-only` bate
-- coluna a coluna com produção, pro corte ser rename/restore.

set search_path to platform, public;

-- ===========================================================================
-- segmentos  (035) — popula o dropdown do cadastro
-- ===========================================================================
create table segmentos (
  id serial primary key,
  slug text not null unique,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into segmentos (slug, nome) values
  ('salao_beleza', 'Salão de Beleza'),
  ('petshop', 'Pet Shop'),
  ('psicologia', 'Psicologia'),
  ('fisioterapia', 'Fisioterapia'),
  ('pilates', 'Pilates'),
  ('outro', 'Outro');

-- ===========================================================================
-- tenants — colunas de cadastro/segmento/onboarding/endereço/billing
-- ===========================================================================
alter table tenants
  -- 023 — data de submissão do cadastro (default now(), not null)
  add column cadastrado_em timestamptz not null default now(),
  -- 018 + 050 — segmento (texto + CHECK; nullable/sem default após 050)
  add column segmento text
    check (segmento in ('salao_beleza', 'petshop', 'psicologia', 'fisioterapia', 'pilates', 'outro')),
  -- 035 — referência nova, gravada pelo cadastro
  add column segmento_id integer references segmentos(id),
  -- 050 — conta ainda sem passar pelo onboarding (segmento/nome do negócio)
  add column onboarding_pendente boolean not null default false,
  -- 041 — checklist de onboarding guiado
  add column onboarding_horario_revisado boolean not null default false,
  add column onboarding_dispensado boolean not null default false,
  -- 026 — endereço estruturado (ViaCEP / tokenização de cartão Asaas)
  add column endereco_cep text,
  add column endereco_logradouro text,
  add column endereco_numero text,
  add column endereco_complemento text,
  add column endereco_bairro text,
  add column endereco_cidade text,
  add column endereco_uf text,
  -- 027 — CPF/CNPJ exigido pelo Customer da Asaas
  add column cpf_cnpj text,
  -- 025 — identificadores Asaas + meio de pagamento (4 últimos dígitos só p/ exibir)
  add column asaas_customer_id text,
  add column asaas_subscription_id text,
  add column asaas_meio_pagamento text check (asaas_meio_pagamento in ('pix', 'cartao')),
  add column asaas_cartao_final text,
  -- 032 — data da última troca de meio de pagamento
  add column asaas_meio_pagamento_alterado_em timestamptz,
  -- 028 — cancelamento (acesso_ate já existe do 001)
  add column cancelado_em timestamptz;

-- ===========================================================================
-- consentimentos_cadastro  (051) — trilha de auditoria imutável do aceite
-- ===========================================================================
create table consentimentos_cadastro (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  termos_versao text not null,
  privacidade_versao text not null,
  aceita_marketing boolean not null default false,
  ip text,
  aceito_em timestamptz not null default now()
);

create index consentimentos_cadastro_tenant_id_idx on consentimentos_cadastro (tenant_id);
