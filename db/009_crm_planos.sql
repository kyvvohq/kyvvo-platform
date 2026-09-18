-- Libera 'crm' como produto valido em planos (pedido do Bruno pra cadastrar
-- precos placeholder do CRM e depois ajustar pelo ADMIN, 2026-09-18). Segue
-- o padrao do People (008_crm_modulo + 001_schema): mesma tabela planos,
-- sem tecnologia/tipo_numero (eixos especificos do Studio).
alter table planos drop constraint if exists planos_produto_check;
alter table planos add constraint planos_produto_check check (produto in ('studio', 'people', 'crm'));

-- Precos placeholder - 3 faixas, valores arbitrarios pra desbloquear o
-- cadastro agora; Bruno ajusta pelo admin (Produtos > CRM > Editar) quando
-- a precificacao real for decidida.
insert into planos (chave, slug, produto, nome, descricao, preco_mensal, ativo) values
  ('crm_start', 'crm-start', 'crm', 'Start', 'Base de clientes e funil de pedidos - placeholder, preco a definir', 97.00, true),
  ('crm_professional', 'crm-professional', 'crm', 'Professional', 'Inclui segmentos, sorteios e importacao - placeholder, preco a definir', 197.00, true),
  ('crm_business', 'crm-business', 'crm', 'Business', 'Multiplos usuarios e recursos de producao - placeholder, preco a definir', 297.00, true)
on conflict (chave) do nothing;
