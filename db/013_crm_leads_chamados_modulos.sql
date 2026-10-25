-- Leads/Chamados (menus internos de atendimento Kyvvo dentro do CRM — ver
-- kyvvo-crm/public/shell.js) deixam de ser liberados automaticamente só por
-- perfil_agente='kyvvo_atendimento'; passam a exigir também um módulo
-- próprio ativado pelo admin por tenant (mesmo padrão de 008_crm_modulo).
-- Nenhum tenant recebe ativação automática aqui — o Bruno liga pelo admin
-- (Tenant > Módulos) caso a caso.
insert into modulos (key, nome, obrigatorio) values
  ('crm_leads', 'CRM — Leads', false),
  ('crm_chamados', 'CRM — Chamados', false)
on conflict (key) do nothing;
