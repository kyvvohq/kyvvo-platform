-- Modelos de e-mail editáveis pelo admin (admin.kyvvo.com.br > E-mail), sem
-- deploy. O produto manda `modelo` (chave) + `variaveis` + dados dinâmicos
-- (link do botão, tabela de detalhes, código); os TEXTOS vêm daqui. Sem linha
-- ativa pro (produto, chave), vale o conteúdo que o produto mandou.
--
-- Placeholders: {{variavel}} ou {{variavel|valor se vazio}}.

set search_path to platform, public;

create table email_modelos (
  id uuid primary key default gen_random_uuid(),
  produto text not null check (produto in ('platform', 'studio', 'people', 'crm')),
  chave text not null,                              -- usada no código do produto
  nome text not null,                               -- nome amigável na tela
  descricao text,                                   -- quando é enviado
  tipo text not null check (tipo in ('notificacao', 'seguranca', 'convite', 'mensagem', 'aviso')),
  assunto text not null,
  titulo text not null,
  corpo text not null default '',                   -- parágrafos separados por linha em branco
  cta_texto text,                                   -- texto do botão (o link vem do produto)
  motivo text,                                      -- rodapé: por que recebeu (tipos sem desativação)
  variaveis jsonb not null default '[]'::jsonb,     -- [{ "nome": "empresa", "exemplo": "Salão da Ana" }]
  ativo boolean not null default true,
  padrao jsonb not null,                            -- textos originais, pra "restaurar padrão"
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (produto, chave)
);

-- Textos fixos do layout (rodapé), chave/valor.
create table email_configuracoes (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

insert into email_configuracoes (chave, valor) values
  ('rodape_nao_responda', 'Este é um e-mail automático — não é necessário respondê-lo.'),
  ('rodape_notificacao', 'Você recebeu este e-mail porque a notificação "{{notificacao}}" está ativada para o canal e-mail.'),
  ('rodape_desativar', 'Você pode desativá-la a qualquer momento em {{caminho}}.'),
  ('caminho_notificacoes_studio', 'Studio → Configurações → Notificações'),
  ('caminho_notificacoes_studio_url', 'https://studio.kyvvo.com.br/painel.html'),
  ('caminho_notificacoes_crm', 'CRM → Configurações → Notificações'),
  ('caminho_notificacoes_crm_url', 'https://crm.kyvvo.com.br/crm/notificacoes.html');

-- Seeds: os e-mails que existem hoje, com os textos atuais.
with seed (produto, chave, nome, descricao, tipo, assunto, titulo, corpo, cta_texto, motivo, variaveis) as (values
  ('platform', 'token_verificacao', 'Código de verificação',
   'Cadastro, login e recuperação de senha (todos os produtos).', 'seguranca',
   'Seu código de verificação Kyvvo — {{codigo}}', 'Seu código de verificação',
   'Use o código abaixo para confirmar seu acesso. Ele expira em {{minutos}} minutos.', null,
   'Se não foi você quem pediu este código, ignore este e-mail e não o compartilhe com ninguém.',
   '[{"nome":"codigo","exemplo":"482915"},{"nome":"minutos","exemplo":"30"},{"nome":"nome","exemplo":"Ana"}]'),
  ('studio', 'convite_equipe', 'Convite de equipe',
   'Administrador convida alguém pra equipe em Configurações > Equipe.', 'convite',
   '{{convidado_por|Alguém}} te convidou para o Kyvvo Studio', 'Você foi convidado para {{empresa}}',
   '{{convidado_por|Um administrador}} te convidou para fazer parte da equipe no Kyvvo Studio, como {{perfil}}.', 'Aceitar convite',
   'O convite expira em {{dias}} dias. Se você não esperava por isso, pode ignorar este e-mail.',
   '[{"nome":"empresa","exemplo":"Salão da Ana"},{"nome":"convidado_por","exemplo":"Juliana"},{"nome":"perfil","exemplo":"operador"},{"nome":"dias","exemplo":"7"}]'),
  ('studio', 'notificacao', 'Notificação',
   'Alertas do Studio com o canal e-mail ativado (novo agendamento, confirmação, etc.).', 'notificacao',
   '{{titulo}}', '{{titulo}}', '{{detalhe}}', 'Abrir no Studio', null,
   '[{"nome":"titulo","exemplo":"Novo agendamento: Ana Souza"},{"nome":"detalhe","exemplo":"Corte + escova, sex 03/10 às 14:30"},{"nome":"notificacao","exemplo":"Novo agendamento"}]'),
  ('crm', 'notificacao', 'Notificação',
   'Alertas do CRM com o canal e-mail ativado (novo lead, pedido, etc.).', 'notificacao',
   '{{titulo}}', '{{titulo}}', '{{detalhe}}', 'Abrir no CRM', null,
   '[{"nome":"titulo","exemplo":"Novo lead pelo formulário"},{"nome":"detalhe","exemplo":"Carlos Lima — (34) 99999-0000"},{"nome":"notificacao","exemplo":"Novo lead"}]'),
  ('people', 'convite_avaliacao', 'Convite para avaliação',
   'Link da avaliação comportamental enviado ao candidato.', 'convite',
   'Você foi convidado para uma avaliação comportamental', 'Você foi convidado para uma avaliação',
   E'Olá, {{nome|tudo bem?}}!\n\nVocê foi convidado a participar de uma avaliação comportamental como parte de um processo seletivo. Leva poucos minutos e não é necessário criar conta.',
   'Iniciar avaliação',
   'Você vai precisar confirmar o e-mail para o qual este convite foi enviado. O link só pode ser usado uma vez.',
   '[{"nome":"nome","exemplo":"Marina"}]'),
  ('people', 'automacao', 'Automação (mensagem ao candidato)',
   'E-mails das automações configuradas pelo recrutador (o texto vem da tela Automações).', 'mensagem',
   '{{assunto}}', '{{assunto}}', '{{corpo}}', null,
   'Você recebeu esta mensagem porque está participando de um processo seletivo.',
   '[{"nome":"assunto","exemplo":"Próxima etapa"},{"nome":"corpo","exemplo":"Olá, Marina! ..."},{"nome":"empresa","exemplo":"Basic 3D Print"}]')
)
insert into email_modelos (produto, chave, nome, descricao, tipo, assunto, titulo, corpo, cta_texto, motivo, variaveis, padrao)
select produto, chave, nome, descricao, tipo, assunto, titulo, corpo, cta_texto, motivo, variaveis::jsonb,
       jsonb_build_object('assunto', assunto, 'titulo', titulo, 'corpo', corpo, 'cta_texto', cta_texto, 'motivo', motivo)
  from seed;
