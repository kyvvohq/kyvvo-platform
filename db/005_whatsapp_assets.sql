-- Kyvvo Admin — WhatsApp (spec §8). Nesta leva só o que tem fonte de dado
-- real: o log de eventos do webhook (o platform já é o único destino
-- cadastrado na Meta e roteia por phone_number_id — ver
-- routes/webhook-whatsapp.js) e os status de mensagem derivados dele.
--
-- WABAs e um cadastro próprio de números entram quando houver gestão de
-- número de verdade no admin — hoje o "número" é derivado de
-- tenants.meta_phone_number_id + chamada à Graph API da Meta.

set search_path to platform, public;

create table whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text,
  tipo text not null default 'outro' check (tipo in ('mensagem', 'status', 'outro')),
  destino text,
  encaminhado boolean not null default false,
  payload jsonb not null,
  recebido_em timestamptz not null default now()
);

create index idx_wwe_recebido on whatsapp_webhook_events (recebido_em desc);
create index idx_wwe_pnid on whatsapp_webhook_events (phone_number_id, recebido_em desc);
create index idx_wwe_tipo on whatsapp_webhook_events (tipo, recebido_em desc);

create table whatsapp_message_status (
  message_id text not null,
  phone_number_id text,
  status text not null,               -- sent | delivered | read | failed
  erro_codigo text,
  erro_titulo text,
  ts timestamptz not null default now(),
  primary key (message_id, status)
);

create index idx_wms_pnid on whatsapp_message_status (phone_number_id, ts desc);
create index idx_wms_status on whatsapp_message_status (status, ts desc);
