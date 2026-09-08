-- Evolution API descontinuada (2026-09-08) — o produto usa o Meta WhatsApp
-- Cloud API (tenant.meta_phone_number_id). A coluna estava preenchida só num
-- tenant de teste suspenso, já zerada antes deste drop. `if exists` deixa
-- idempotente; o drop da coluna leva junto o índice unique.
alter table platform.tenants drop column if exists instancia_whatsapp;
