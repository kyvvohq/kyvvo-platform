-- Compra avulsa de creditos de WhatsApp do CRM (pedido do Bruno, 2026-10-21).
-- Diferente de planos/assinatura: cobranca unica via Asaas POST /payments,
-- nao recorrente. O saldo em si (quanto o tenant tem disponivel) vive no
-- banco do proprio CRM (consumido por lib/automacoes.js a cada disparo) -
-- esta tabela e so o registro do pagamento/pedido de compra, pra conferir o
-- webhook da Asaas e decidir quando avisar o CRM pra creditar.
create table if not exists compras_creditos_crm (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  pacote_chave text not null,
  quantidade_creditos integer not null,
  valor numeric(10,2) not null,
  meio text not null check (meio in ('pix', 'cartao')),
  asaas_customer_id text not null,
  asaas_payment_id text not null unique,
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'falhou')),
  creditado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists compras_creditos_crm_tenant_idx on compras_creditos_crm (tenant_id, criado_em desc);
