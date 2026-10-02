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
