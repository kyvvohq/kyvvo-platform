-- Serviço de e-mail da plataforma (AWS SES). Todos os produtos mandam e-mail
-- via POST /internal/email/send do platform — um só remetente verificado
-- (kyvvo.com.br), um só log e uma só lista de supressão, em vez de cada
-- produto com sua própria cópia do fetch pra Resend.

set search_path to platform, public;

-- Um registro por destinatário por envio. `message_id` é o id devolvido pelo
-- provedor (SES MessageId) — é por ele que os eventos do SNS (entrega,
-- bounce, reclamação) atualizam o status.
create table email_envios (
  id uuid primary key default gen_random_uuid(),
  produto text not null,
  tag text,                                         -- ex.: 'token_verificacao', 'convite_equipe'
  remetente text not null,
  destinatario text not null,
  assunto text not null,
  provedor text not null,                           -- 'ses' | 'resend' | 'log'
  message_id text,
  status text not null
    check (status in ('enviado', 'entregue', 'bounce', 'reclamacao', 'rejeitado', 'falhou', 'suprimido', 'log')),
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index idx_email_envios_message_id on email_envios (message_id) where message_id is not null;
create index idx_email_envios_produto_criado on email_envios (produto, criado_em desc);
create index idx_email_envios_destinatario on email_envios (lower(destinatario));

-- Endereços que não recebem mais nada: bounce permanente ou reclamação de
-- spam. Mandar de novo pra eles derruba a reputação da conta SES (e a AWS
-- pausa o envio se a taxa de bounce passar de ~5% / reclamação ~0,1%).
create table email_supressoes (
  email text primary key,                           -- sempre em minúsculas
  motivo text not null check (motivo in ('bounce', 'reclamacao', 'manual')),
  detalhe text,
  criado_em timestamptz not null default now()
);
