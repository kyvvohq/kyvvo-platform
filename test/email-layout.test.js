const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { renderizarEmail, validarLayout, textoParaHtml } = require('../lib/email-layout');
const email = require('../lib/email');

describe('email-layout', () => {
  test('validarLayout: tipo, título e cta https obrigatórios', () => {
    assert.match(validarLayout({ tipo: 'x', titulo: 'a' }), /tipo inválido/);
    assert.match(validarLayout({ tipo: 'aviso' }), /titulo/);
    assert.match(validarLayout({ tipo: 'aviso', titulo: 'a', cta: { texto: 'ir', url: 'javascript:alert(1)' } }), /https/);
    assert.equal(validarLayout({ tipo: 'notificacao', titulo: 'a', cta: { texto: 'ir', url: 'https://x' } }), null);
  });

  test('notificação: selo do produto, caminho pra desativar e "não responda"', () => {
    const { html, text } = renderizarEmail('studio', { tipo: 'notificacao', notificacao: 'Novo agendamento', titulo: 'Novo agendamento' });
    assert.match(html, /Notificação · Studio/);
    assert.match(html, /Studio → Configurações → Notificações/);
    assert.match(html, /não é necessário respondê-lo/);
    assert.match(text, /desativá-la a qualquer momento em Studio → Configurações → Notificações/);
    assert.match(text, /"Novo agendamento" está ativada/);
  });

  test('CRM aponta pro caminho do CRM', () => {
    const { text } = renderizarEmail('crm', { tipo: 'notificacao', titulo: 'x' });
    assert.match(text, /CRM → Configurações → Notificações \(https:\/\/crm\.kyvvo\.com\.br\/crm\/notificacoes\.html\)/);
  });

  test('tipos sem desativação usam o motivo, mas sempre dizem que não precisa responder', () => {
    const { text } = renderizarEmail('platform', { tipo: 'seguranca', titulo: 'Código', destaque: '123456', motivo: 'Se não foi você, ignore.' });
    assert.doesNotMatch(text, /desativá-la/);
    assert.match(text, /Se não foi você, ignore\./);
    assert.match(text, /não é necessário respondê-lo/);
    assert.match(text, /123456/);
  });

  test('escapa todo conteúdo vindo do produto', () => {
    const { html } = renderizarEmail('crm', {
      tipo: 'notificacao', titulo: '<script>x</script>', paragrafos: ['<img src=x onerror=1>'],
      detalhes: [{ rotulo: 'Nome', valor: '<b>Ana</b>' }],
    });
    assert.doesNotMatch(html, /<script>x|<img src=x|<b>Ana/);
    assert.match(html, /&lt;script&gt;x/);
  });

  test('textoParaHtml linkifica https e mantém quebras', () => {
    const h = textoParaHtml('Oi <b>\nhttps://a.com/x');
    assert.match(h, /Oi &lt;b&gt;<br><a href="https:\/\/a\.com\/x"/);
  });

  test('detalhes vazios são omitidos', () => {
    const { text } = renderizarEmail('studio', { tipo: 'aviso', titulo: 't', detalhes: [{ rotulo: 'A', valor: '' }, { rotulo: 'B', valor: 'b' }] });
    assert.doesNotMatch(text, /^A:/m);
    assert.match(text, /^B: b$/m);
  });
});

describe('lib/email com layout', () => {
  test('layout vira html+text antes de enviar', async () => {
    let enviado;
    const r = await email.enviar(
      { produto: 'studio', to: 'a@b.com', subject: 'S', layout: { tipo: 'notificacao', titulo: 'T' } },
      { env: { EMAIL_PROVIDER: 'ses' }, pool: null, sesSend: async (i) => { enviado = i; return { MessageId: 'm' }; } },
    );
    assert.equal(r.ok, true);
    assert.match(enviado.Content.Simple.Body.Html.Data, /Notificação · Studio/);
    assert.match(enviado.Content.Simple.Body.Text.Data, /não é necessário respondê-lo/);
  });

  test('layout inválido é recusado', async () => {
    const r = await email.enviar({ to: 'a@b.com', subject: 'S', layout: { tipo: 'nada', titulo: 'T' } }, { env: {}, pool: null });
    assert.match(r.erro, /tipo inválido/);
  });
});

describe('email-modelos', () => {
  const modelos = require('../lib/email-modelos');

  test('substituir: variável, padrão e desconhecida', () => {
    assert.equal(modelos.substituir('Olá, {{nome}}!', { nome: 'Ana' }), 'Olá, Ana!');
    assert.equal(modelos.substituir('Olá, {{ nome | tudo bem? }}!', { nome: ' ' }), 'Olá, tudo bem?!');
    assert.equal(modelos.substituir('{{x}}-{{y|b}}', {}), '-b');
  });

  test('aplicarModelo: textos do modelo + dinâmico do produto; botão só com url', () => {
    const m = { tipo: 'convite', assunto: '{{quem}} te convidou', titulo: 'Convite p/ {{empresa}}', corpo: 'Oi {{nome|você}}', cta_texto: 'Aceitar', motivo: 'Expira em {{dias}} dias' };
    const r = modelos.aplicarModelo(m, { layout: { cta: { texto: 'x', url: 'https://a/b' }, detalhes: [{ rotulo: 'A', valor: 'b' }] }, variaveis: { quem: 'Ju', empresa: 'Salão', dias: 7 } });
    assert.equal(r.assunto, 'Ju te convidou');
    assert.equal(r.layout.titulo, 'Convite p/ Salão');
    assert.equal(r.layout.corpoTexto, 'Oi você');
    assert.deepEqual(r.layout.cta, { texto: 'Aceitar', url: 'https://a/b' });
    assert.equal(r.layout.motivo, 'Expira em 7 dias');
    assert.equal(r.layout.detalhes.length, 1);
    assert.equal(modelos.aplicarModelo(m, {}).layout.cta, undefined);
  });

  test('rodapé usa a configuração editável', () => {
    const { text } = renderizarEmail('studio', { tipo: 'notificacao', titulo: 't', notificacao: 'X' }, {
      rodape_notificacao: 'Alerta {{notificacao}} ligado.', rodape_desativar: 'Desligue em {{caminho}} quando quiser.',
      caminho_notificacoes_studio: 'Menu A', caminho_notificacoes_studio_url: 'https://s/x', rodape_nao_responda: 'Não responda.',
    });
    assert.match(text, /Alerta X ligado\./);
    assert.match(text, /Desligue em Menu A \(https:\/\/s\/x\) quando quiser\./);
    assert.match(text, /Não responda\./);
  });

  test('enviar com modelo: textos do modelo; sem modelo ativo, usa o layout do produto', async () => {
    const dados = {
      config: modelos.CONFIG_PADRAO,
      modelos: new Map([['studio:convite_equipe', { tipo: 'convite', assunto: 'Assunto {{empresa}}', titulo: 'T {{empresa}}', corpo: 'C', cta_texto: 'Ir', motivo: null }]]),
    };
    let input;
    const deps = { env: { EMAIL_PROVIDER: 'ses' }, pool: null, modelos: dados, sesSend: async (i) => { input = i; return { MessageId: 'm' }; } };
    await email.enviar({ produto: 'studio', to: 'a@b.com', subject: 'fallback', modelo: 'convite_equipe', variaveis: { empresa: 'Salão' }, layout: { tipo: 'convite', titulo: 'x', cta: { texto: 'y', url: 'https://l' } } }, deps);
    assert.equal(input.Content.Simple.Subject.Data, 'Assunto Salão');
    assert.match(input.Content.Simple.Body.Text.Data, /T Salão/);
    assert.match(input.Content.Simple.Body.Text.Data, /Ir: https:\/\/l/);
    await email.enviar({ produto: 'crm', to: 'a@b.com', subject: 'fallback', modelo: 'inexistente', layout: { tipo: 'aviso', titulo: 'Layout do produto' } }, deps);
    assert.equal(input.Content.Simple.Subject.Data, 'fallback');
    assert.match(input.Content.Simple.Body.Text.Data, /Layout do produto/);
  });

  test('modelo da plataforma vale pra qualquer produto sem modelo próprio', async () => {
    const dados = { config: modelos.CONFIG_PADRAO, modelos: new Map([['platform:token_verificacao', { tipo: 'seguranca', assunto: 'Código {{codigo}}', titulo: 'Código', corpo: '', cta_texto: null, motivo: null }]]) };
    let input;
    await email.enviar({ produto: 'studio', to: 'a@b.com', subject: 'x', modelo: 'token_verificacao', variaveis: { codigo: '1' }, layout: { tipo: 'seguranca', titulo: 'x', destaque: '1' } },
      { env: { EMAIL_PROVIDER: 'ses' }, pool: null, modelos: dados, sesSend: async (i) => { input = i; return { MessageId: 'm' }; } });
    assert.equal(input.Content.Simple.Subject.Data, 'Código 1');
  });
});
