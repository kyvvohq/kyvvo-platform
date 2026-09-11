-- Kyvvo Admin — permissões novas pro corte (Fase 5): config de sistema
-- (trial_dias etc., editável sem deploy — vinha do admin do Studio) e edição
-- do cadastro de um tenant. Papéis são seed (db/004); ao adicionar permissão
-- nova, incluir no mapeamento aqui.

set search_path to platform, public;

insert into admin_permissions (chave, descricao) values
  ('config:read',    'Ver as configurações do sistema'),
  ('config:write',   'Alterar as configurações do sistema (trial, carência, suporte)'),
  ('clientes:editar','Editar o cadastro de uma empresa (nome, contato, endereço)');

-- superadmin ganha as três
insert into admin_role_permissions (role_chave, permission_chave) values
  ('superadmin', 'config:read'),
  ('superadmin', 'config:write'),
  ('superadmin', 'clientes:editar'),
  ('suporte',    'config:read'),
  ('suporte',    'clientes:editar'),
  ('billing',    'config:read'),
  ('read_only',  'config:read');
