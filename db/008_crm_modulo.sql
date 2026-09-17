-- Terceiro produto da Plataforma Kyvvo (kyvvohq/kyvvo-crm). Mesmo padrão do
-- módulo 'people' (007/001_schema.sql): cadastro pontual, sem preço ainda
-- (Fase 1 do CRM não decidiu plano/preço — ver kyvvo-crm/docs/DECISOES-PENDENTES.md).
insert into modulos (key, nome, obrigatorio) values
  ('crm', 'Kyvvo CRM', false)
on conflict (key) do nothing;
