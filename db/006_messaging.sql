-- Kyvvo Admin — Messaging (spec §9/§10): templates de disparo + campanhas.
--
-- Templates têm dado real desde já (o time cria/versiona/submete pela tela).
-- Campanhas são modeladas aqui pra a interface não precisar de rework quando
-- o mecanismo de dispatch existir — nesta leva o admin não popula campanhas
-- (a tela mostra o vazio).

set search_path to platform, public;

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  produto text not null check (produto in ('studio', 'people', 'leads', 'crm')),
  nome_interno text not null,
  meta_nome text,                                   -- nome submetido à Meta (snake_case)
  categoria text not null default 'utility'
    check (categoria in ('utility', 'marketing', 'authentication')),
  idioma text not null default 'pt_BR',
  corpo text not null,
  variaveis jsonb not null default '[]'::jsonb,     -- [{ "nome": "cliente", "exemplo": "Ana" }]
  descricao_uso text,
  estado text not null default 'rascunho'
    check (estado in ('rascunho', 'enviado', 'em_analise', 'aprovado', 'rejeitado', 'arquivado')),
  meta_status text,                                 -- status cru devolvido pela Meta
  meta_sync_em timestamptz,
  meta_motivo_rejeicao text,
  versao integer not null default 1,
  autor_admin_id uuid references admin_users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (produto, nome_interno)
);

create index idx_mt_produto_estado on message_templates (produto, estado);

create table message_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references message_templates(id) on delete cascade,
  versao integer not null,
  snapshot jsonb not null,                          -- cópia dos campos editáveis no momento
  autor_admin_id uuid references admin_users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (template_id, versao)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  produto text not null,
  tenant_id uuid,
  template_id uuid references message_templates(id) on delete set null,
  numero_remetente text,
  audiencia_descricao text,
  janela_inicio timestamptz,
  janela_fim timestamptz,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'agendada', 'enviando', 'concluida', 'cancelada')),
  criado_em timestamptz not null default now()
);

create table campaign_results (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  metrica text not null,                            -- enviados|entregues|lidos|falhos|respostas|conversoes
  valor integer not null default 0,
  primary key (campaign_id, metrica)
);
