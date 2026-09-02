-- Kyvvo Platform — schema canônico do serviço de identidade/sessão/entitlements.
--
-- Consolida, na forma final (depois de todos os `alter table`), as tabelas
-- que hoje vivem no schema `public` do banco do Studio (kyvvo/server/db/,
-- migrations 001..064) e que a fase P3 tira de dentro de `server/panel`:
--
--   tenants, usuarios, tokens_validacao, eventos_analytics,
--   configuracoes_sistema, modulos, tenant_modulos, planos, plano_features,
--   plano_limites
--
-- Objetivo: `pg_dump --schema-only -n platform` bate 1:1 (coluna a coluna,
-- constraint a constraint) com as tabelas equivalentes de produção hoje, pra
-- o corte da próxima leva ser um rename/restore, não um rebuild.
--
-- FORA desta leva (entram num 002_*.sql quando o billing e o cadastro
-- self-service forem portados): as colunas de billing de `tenants`
-- (asaas_*, endereco_*, cpf_cnpj, cancelado_em, segmento*), e as tabelas
-- `segmentos` / `consentimentos_cadastro` / `assinaturas`.
--
-- Colunas de auditoria administrativa que referenciavam `kyvvo_admins`
-- (`planos.atualizado_por`, `configuracoes_sistema.atualizado_por`) viram
-- `uuid` solto, sem FK: identidade de admin da Kyvvo continua no domínio do
-- Studio, a plataforma não a possui.

create schema if not exists platform;
set search_path to platform, public;

-- ===========================================================================
-- tenants  (001_init + alters 015,020,021,024,025,028,054)
-- ===========================================================================
create table tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  endereco text,
  whatsapp text,
  instancia_whatsapp text unique,
  plano text,
  ativo boolean not null default true,
  status text not null default 'ativo'
    check (status in ('ativo', 'trial', 'inadimplente', 'suspenso', 'expirado', 'cancelado')),
  trial_expires_at timestamptz,
  ativado_em timestamptz,
  status_alterado_em timestamptz,
  acesso_ate date,
  criado_em timestamptz not null default now()
);

create unique index uq_tenants_whatsapp on tenants (whatsapp) where whatsapp is not null;

-- ===========================================================================
-- usuarios  (003_usuarios + alters 009,021,043)
-- ===========================================================================
create table usuarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null unique,
  senha_hash text not null,
  nome text,
  token_version integer not null default 0,
  email_verified boolean not null default false,
  role text not null default 'administrador' check (role in ('administrador', 'operador')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create index idx_usuarios_email on usuarios (email);

-- ===========================================================================
-- tokens_validacao  (021_cadastro_self_service + alter 022)
-- ===========================================================================
create table tokens_validacao (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references usuarios(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  usado boolean not null default false,
  tentativas int not null default 0,
  tipo text not null default 'email_verificacao'
    check (tipo in ('email_verificacao', 'recuperacao_senha', 'alteracao_email', 'alteracao_whatsapp')),
  criado_em timestamptz not null default now()
);

create index idx_tokens_validacao_user_tipo on tokens_validacao (user_id, tipo) where not usado;
create index idx_tokens_validacao_user_criado on tokens_validacao (user_id, criado_em);

-- ===========================================================================
-- eventos_analytics  (036) — funil de conversão pós-trial
-- ===========================================================================
create table eventos_analytics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tipo text not null,
  criado_em timestamptz not null default now()
);

create index idx_eventos_analytics_tenant on eventos_analytics (tenant_id, tipo, criado_em);

-- ===========================================================================
-- configuracoes_sistema  (029) — chave/valor editável pelo admin sem deploy
-- ===========================================================================
create table configuracoes_sistema (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

insert into configuracoes_sistema (chave, valor) values
  ('trial_dias', '14'),
  ('carencia_dias_inadimplencia', '3'),
  ('max_tentativas_reenvio_token', '5'),
  ('email_suporte', 'suporte@kyvvo.com.br'),
  ('whatsapp_suporte', '553484285182');

-- ===========================================================================
-- modulos / tenant_modulos  (010 + alters 044,063)
-- ===========================================================================
create table modulos (
  key text primary key,
  nome text not null,
  preco_mensal numeric(10,2),
  obrigatorio boolean not null default false,
  criado_em timestamptz not null default now()
);

insert into modulos (key, nome, obrigatorio) values
  ('agenda_inteligente',  'Agenda Inteligente', true),
  ('financeiro',          'Financeiro',         false),
  ('dashboards',          'Dashboards',         false),
  ('estoque',             'Estoque',            false),
  ('comissao',            'Comissão',           false),
  ('campanhas_proativas', 'Campanhas Proativas', false),
  ('people',              'Kyvvo People',       false);

create table tenant_modulos (
  tenant_id uuid not null references tenants(id) on delete cascade,
  modulo_key text not null references modulos(key) on delete cascade,
  ativo boolean not null default true,
  ativado_em timestamptz not null default now(),
  primary key (tenant_id, modulo_key)
);

create index idx_tenant_modulos_tenant on tenant_modulos (tenant_id) where ativo;

-- ===========================================================================
-- planos  (029 + alters 045,047,048,049,064) — catálogo Studio + People
-- ===========================================================================
create table planos (
  chave text primary key,
  slug text not null unique,
  produto text not null default 'studio' check (produto in ('studio', 'people')),
  nome text not null,
  descricao text,
  preco_mensal numeric(10,2) not null check (preco_mensal >= 1),
  limite_disparos integer,
  tecnologia text check (tecnologia in ('bot', 'ia')),
  tipo_numero text check (tipo_numero in ('proprio', 'kyvvo')),
  destaque boolean not null default false,
  badge text,
  headline_diferencial text,
  frase_beneficio text,
  herda_de text references planos(chave),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  constraint planos_headline_diferencial_tamanho check (char_length(headline_diferencial) <= 120),
  constraint planos_frase_beneficio_tamanho check (char_length(frase_beneficio) <= 120)
);

-- Studio — grade 2x2 (045) com nomes do eixo de valor (047) e copy (048).
insert into planos
  (chave, slug, produto, nome, descricao, tecnologia, tipo_numero, preco_mensal, limite_disparos,
   destaque, badge, headline_diferencial, frase_beneficio, ativo)
values
  ('starter', 'essencial', 'studio', 'Essencial', 'Bot de agendamento + número próprio',
   'bot', 'proprio', 79.90, 100, false, null,
   'Seu número, atendimento guiado',
   'A cliente escolhe o serviço e o horário por listas e botões. Simples, rápido e previsível.', true),
  ('business', 'essencial-plus', 'studio', 'Essencial Plus', 'Bot de agendamento + número Kyvvo pronto',
   'bot', 'kyvvo', 119.90, 100, false, null,
   'Número pronto, zero configuração',
   'A gente entrega o número já ativo na API oficial. Você só cadastra seus serviços.', true),
  ('professional', 'smart', 'studio', 'Smart', 'IA conversacional + número próprio',
   'ia', 'proprio', 149.90, 500, false, null,
   'Seu número, atendimento que conversa',
   'A cliente escreve como fala — "quero cortar amanhã de manhã" — e o bot resolve.', true),
  ('enterprise', 'smart-plus', 'studio', 'Smart Plus', 'IA conversacional + número Kyvvo pronto',
   'ia', 'kyvvo', 179.90, 500, true, 'Mais popular',
   'Número pronto, atendimento premium',
   'Sem configuração e com atendimento em linguagem natural. O pacote completo.', true);

-- People — planos próprios (064), mesma tabela, `produto = 'people'`.
insert into planos (chave, slug, produto, nome, descricao, preco_mensal, ativo) values
  ('people_start', 'people-start', 'people', 'Start', 'Até 3 vagas ativas simultâneas', 197.00, true),
  ('people_professional', 'people-professional', 'people', 'Professional', 'Até 10 vagas ativas simultâneas', 497.00, true);

-- Herança de features Studio (049).
update planos set herda_de = 'starter' where chave in ('business', 'professional');
update planos set herda_de = 'professional' where chave = 'enterprise';

-- ===========================================================================
-- plano_features / plano_limites  (049 + alter 064)
-- ===========================================================================
create table plano_features (
  id uuid primary key default gen_random_uuid(),
  plano_chave text not null references planos(chave) on delete cascade,
  label text not null,
  ordem integer not null default 1
);
create index idx_plano_features_plano on plano_features (plano_chave, ordem);

create table plano_limites (
  id uuid primary key default gen_random_uuid(),
  plano_chave text not null references planos(chave) on delete cascade,
  chave text not null check (chave in
    ('conversas_mes', 'profissionais', 'unidades', 'vagas_ativas', 'candidatos_notificados_mes')),
  valor integer,
  unidade text,
  unique (plano_chave, chave)
);

insert into plano_features (plano_chave, label, ordem) values
  ('starter', 'Fluxo guiado por listas e botões', 1),
  ('starter', 'Confirmação automática', 2),
  ('starter', 'Agenda sem conflito de horário', 3),
  ('business', 'Número virtual gerenciado pelo Kyvvo', 1),
  ('business', 'Verificação na Meta feita por nós', 2),
  ('business', 'Pronto para atender no mesmo dia', 3),
  ('professional', 'Bot entende linguagem natural', 1),
  ('professional', 'Reagendamento e cancelamento por texto livre', 2),
  ('professional', 'Menos conversa abandonada', 3),
  ('enterprise', 'Número virtual gerenciado pelo Kyvvo', 1),
  ('enterprise', 'Verificação na Meta feita por nós', 2),
  ('enterprise', 'Atendimento por IA sem configuração', 3);

insert into plano_limites (plano_chave, chave, valor) values
  ('starter', 'conversas_mes', 100), ('starter', 'profissionais', 3), ('starter', 'unidades', 1),
  ('business', 'conversas_mes', 100), ('business', 'profissionais', 3), ('business', 'unidades', 1),
  ('professional', 'conversas_mes', 500), ('professional', 'profissionais', 5), ('professional', 'unidades', 1),
  ('enterprise', 'conversas_mes', 500), ('enterprise', 'profissionais', 5), ('enterprise', 'unidades', 1),
  ('people_start', 'vagas_ativas', 3), ('people_start', 'candidatos_notificados_mes', 150),
  ('people_professional', 'vagas_ativas', 10), ('people_professional', 'candidatos_notificados_mes', 600);
