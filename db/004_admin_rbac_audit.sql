-- Kyvvo Admin — identidade, RBAC e auditoria do portal administrativo.
--
-- O Kyvvo Admin passa a viver no kyvvo-platform (ver
-- docs/admin-portal/arquitetura-e-plano.md). A identidade de admin da Kyvvo,
-- que hoje vive em `kyvvo_admins` no schema `public` do banco do Studio, vem
-- pra cá. Esta migration cria só o schema + o catálogo de papéis/permissões;
-- a cópia das linhas reais de `kyvvo_admins` (poucas, mesmo hash bcrypt) é
-- passo de dados do corte (Fase 5), não desta migration.
--
-- FKs órfãs no Studio: colunas que referenciavam `kyvvo_admins` (029, 037,
-- 044, 046) viram `uuid` solto lá quando o corte acontecer — mesmo movimento
-- que o platform já fez com `planos.atualizado_por`.

set search_path to platform, public;

-- ===========================================================================
-- admin_users — o time interno da Kyvvo que opera o portal
-- ===========================================================================
create table admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  senha_hash text not null,
  nome text,
  ativo boolean not null default true,
  ultimo_login_em timestamptz,
  criado_em timestamptz not null default now()
);

-- ===========================================================================
-- papéis / permissões (RBAC) — permissão é a unidade que os guards checam;
-- papel é só um agrupamento pra atribuição
-- ===========================================================================
create table admin_roles (
  chave text primary key,
  nome text not null,
  descricao text
);

create table admin_permissions (
  chave text primary key,          -- ex.: 'clientes:read', 'plano:alterar'
  descricao text not null
);

create table admin_role_permissions (
  role_chave text not null references admin_roles(chave) on delete cascade,
  permission_chave text not null references admin_permissions(chave) on delete cascade,
  primary key (role_chave, permission_chave)
);

create table admin_user_roles (
  admin_id uuid not null references admin_users(id) on delete cascade,
  role_chave text not null references admin_roles(chave) on delete cascade,
  primary key (admin_id, role_chave)
);

-- ===========================================================================
-- audit_events — toda ação administrativa sensível registra aqui
-- (spec §6: ator, tenant, ação, timestamp, valor antes/depois)
-- ===========================================================================
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  ator_admin_id uuid references admin_users(id) on delete set null,
  acao text not null,              -- ex.: 'tenant.suspender'
  entidade_tipo text,              -- ex.: 'tenant', 'template', 'feature_flag'
  entidade_id text,
  tenant_id uuid,
  valor_antes jsonb,
  valor_depois jsonb,
  ip text,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index idx_audit_events_ator on audit_events (ator_admin_id, criado_em desc);
create index idx_audit_events_entidade on audit_events (entidade_tipo, entidade_id, criado_em desc);
create index idx_audit_events_tenant on audit_events (tenant_id, criado_em desc);

-- ===========================================================================
-- feature_flags — liga/desliga por ambiente/produto/tenant (spec §13)
-- ===========================================================================
create table feature_flags (
  chave text not null,
  escopo text not null default 'global' check (escopo in ('global', 'produto', 'tenant')),
  alvo text not null default '*',   -- '*' (global) | <produto> | <tenant_id>
  valor boolean not null default false,
  atualizado_por uuid references admin_users(id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (chave, escopo, alvo)
);

-- ===========================================================================
-- catálogo de permissões
-- ===========================================================================
insert into admin_permissions (chave, descricao) values
  ('clientes:read',    'Ver empresas, usuários e visão 360°'),
  ('clientes:suspend', 'Suspender / reativar empresa'),
  ('plano:alterar',    'Alterar plano / entitlements de um tenant'),
  ('billing:read',     'Ver assinaturas, cobranças e histórico'),
  ('whatsapp:read',    'Ver números, WABAs, saúde e logs de WhatsApp'),
  ('whatsapp:disable', 'Desabilitar envio / desconectar número'),
  ('template:read',    'Ver templates de disparo'),
  ('template:write',   'Criar, editar e submeter templates'),
  ('campanha:read',    'Ver campanhas e relatórios'),
  ('flag:read',        'Ver feature flags'),
  ('flag:write',       'Alterar feature flags'),
  ('auditoria:read',   'Ver o log de auditoria'),
  ('admin:manage',     'Gerenciar admins, papéis e permissões');

-- ===========================================================================
-- catálogo de papéis + mapeamento pra permissões
-- ===========================================================================
insert into admin_roles (chave, nome, descricao) values
  ('superadmin',   'Superadmin',      'Acesso total ao portal'),
  ('suporte',      'Suporte',         'Leitura ampla + ações operacionais leves'),
  ('billing',      'Billing',         'Assinaturas, cobranças e planos'),
  ('whatsapp_ops', 'WhatsApp Ops',    'Operação de números, WABAs e templates'),
  ('read_only',    'Somente leitura', 'Vê tudo, não altera nada');

-- superadmin = todas as permissões (inclusive as que vierem depois? não —
-- inserção explícita; ao adicionar permissão nova, incluir aqui no próximo
-- migration ou via tela de Sistema)
insert into admin_role_permissions (role_chave, permission_chave)
  select 'superadmin', chave from admin_permissions;

insert into admin_role_permissions (role_chave, permission_chave) values
  ('suporte', 'clientes:read'),
  ('suporte', 'clientes:suspend'),
  ('suporte', 'billing:read'),
  ('suporte', 'whatsapp:read'),
  ('suporte', 'template:read'),
  ('suporte', 'campanha:read'),
  ('suporte', 'auditoria:read'),

  ('billing', 'clientes:read'),
  ('billing', 'billing:read'),
  ('billing', 'plano:alterar'),

  ('whatsapp_ops', 'clientes:read'),
  ('whatsapp_ops', 'whatsapp:read'),
  ('whatsapp_ops', 'whatsapp:disable'),
  ('whatsapp_ops', 'template:read'),
  ('whatsapp_ops', 'template:write'),
  ('whatsapp_ops', 'campanha:read'),

  ('read_only', 'clientes:read'),
  ('read_only', 'billing:read'),
  ('read_only', 'whatsapp:read'),
  ('read_only', 'template:read'),
  ('read_only', 'campanha:read'),
  ('read_only', 'flag:read'),
  ('read_only', 'auditoria:read');
