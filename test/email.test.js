const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const email = require('../lib/email');
const sns = require('../lib/sns');
const { lerTokensProdutos, produtoDoToken, interpretarEventoSes } = require('../routes/email');

// Pool falso: registra as queries e responde SELECT de supressão com `supressos`.
function poolFalso(supressos = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM email_supressoes/.test(sql)) return { rows: supressos.map((e) => ({ email: e })) };
      return { rows: [] };
    },
  };
}

describe('lib/email — validação e remetente', () => {
  test('validarMensagem recusa destinatário inválido, sem assunto e sem corpo', () => {
    assert.equal(email.validarMensagem({ to: 'x', subject: 'a', html: 'b' }), 'Destinatário inválido');
    assert.equal(email.validarMensagem({ to: 'a@b.com', subject: ' ', html: 'b' }), 'Assunto obrigatório');
    assert.equal(email.validarMensagem({ to: 'a@b.com', subject: 'a' }), 'Corpo obrigatório (html ou text)');
    assert.equal(email.validarMensagem({ to: ['a@b.com', 'c@d.com'], subject: 'a', text: 'b' }), null);
  });

  test('remetente só do domínio kyvvo.com.br', () => {
    assert.equal(email.remetentePermitido('Kyvvo <no-reply@kyvvo.com.br>'), true);
    assert.equal(email.remetentePermitido('no-reply@kyvvo.com.br'), true);
    assert.equal(email.remetentePermitido('Fake <x@gmail.com>'), false);
    assert.equal(email.remetentePermitido('x@kyvvo.com.br.evil.com'), false);
  });

  test('montarRemetente usa EMAIL_FROM_<PRODUTO> e personaliza só o nome', () => {
    const env = { EMAIL_FROM_PEOPLE: 'Kyvvo People <people@kyvvo.com.br>' };
    assert.equal(email.montarRemetente({ produto: 'people', env }), 'Kyvvo People <people@kyvvo.com.br>');
    assert.equal(email.montarRemetente({ produto: 'studio', env }), 'Kyvvo <no-reply@kyvvo.com.br>');
    assert.equal(
      email.montarRemetente({ produto: 'studio', fromName: 'Salão "Bela" <x>', env }),
      '"Salão Bela x" <no-reply@kyvvo.com.br>',
    );
  });

  test('escolherProvedor: explícito > resend se tiver chave > log', () => {
    assert.equal(email.escolherProvedor({ EMAIL_PROVIDER: 'SES', RESEND_API_KEY: 'k' }), 'ses');
    assert.equal(email.escolherProvedor({ RESEND_API_KEY: 'k' }), 'resend');
    assert.equal(email.escolherProvedor({}), 'log');
  });

  test('montarEntradaSes: tags de produto/tag e configuration set', () => {
    const input = email.montarEntradaSes(
      { remetente: 'r@kyvvo.com.br', destinatario: 'a@b.com', subject: 's', html: '<b>h</b>', produto: 'crm', tag: 'convite equipe' },
      { SES_CONFIGURATION_SET: 'kyvvo-default' },
    );
    assert.equal(input.ConfigurationSetName, 'kyvvo-default');
    assert.deepEqual(input.EmailTags, [{ Name: 'produto', Value: 'crm' }, { Name: 'tag', Value: 'convite_equipe' }]);
    assert.equal(input.Content.Simple.Body.Html.Data, '<b>h</b>');
    assert.equal(input.Content.Simple.Body.Text, undefined);
  });
});

describe('lib/email — enviar', () => {
  test('SES: um envio por destinatário, registra message_id', async () => {
    const pool = poolFalso();
    const enviados = [];
    const r = await email.enviar(
      { produto: 'studio', to: ['A@x.com', 'a@x.com', 'b@x.com'], subject: 'Oi', html: '<p>oi</p>' },
      { env: { EMAIL_PROVIDER: 'ses' }, pool, sesSend: async (input) => { enviados.push(input); return { MessageId: `m${enviados.length}` }; } },
    );
    assert.equal(r.ok, true);
    assert.equal(enviados.length, 2); // A@x.com e a@x.com são o mesmo endereço
    assert.deepEqual(r.resultados.map((x) => x.messageId), ['m1', 'm2']);
    const inserts = pool.queries.filter((q) => /INSERT INTO email_envios/.test(q.sql));
    assert.equal(inserts.length, 2);
    assert.equal(inserts[0].params[7], 'enviado');
  });

  test('destinatário suprimido não é enviado', async () => {
    const pool = poolFalso(['b@x.com']);
    let chamadas = 0;
    const r = await email.enviar(
      { to: ['a@x.com', 'b@x.com'], subject: 'Oi', text: 'oi' },
      { env: { EMAIL_PROVIDER: 'ses' }, pool, sesSend: async () => { chamadas += 1; return { MessageId: 'm' }; } },
    );
    assert.equal(chamadas, 1);
    assert.equal(r.ok, false);
    assert.equal(r.resultados.find((x) => x.to === 'b@x.com').status, 'suprimido');
  });

  test('falha do provedor vira status falhou, sem lançar', async () => {
    const r = await email.enviar(
      { to: 'a@x.com', subject: 'Oi', text: 'oi' },
      { env: { EMAIL_PROVIDER: 'ses' }, pool: null, sesSend: async () => { throw new Error('MessageRejected'); } },
    );
    assert.equal(r.ok, false);
    assert.equal(r.resultados[0].status, 'falhou');
  });

  test('remetente de outro domínio é recusado antes de enviar', async () => {
    const r = await email.enviar(
      { to: 'a@x.com', subject: 'Oi', text: 'oi', from: 'x@gmail.com' },
      { env: { EMAIL_PROVIDER: 'ses' }, pool: null, sesSend: async () => assert.fail('não devia enviar') },
    );
    assert.match(r.erro, /Remetente não permitido/);
  });

  test('sem provedor: modo log, ok', async () => {
    const r = await email.enviar({ to: 'a@x.com', subject: 'Oi', text: 'oi' }, { env: {}, pool: null });
    assert.equal(r.ok, true);
    assert.equal(r.resultados[0].status, 'log');
  });
});

describe('routes/email — tokens por produto', () => {
  test('lerTokensProdutos ignora pares malformados', () => {
    const m = lerTokensProdutos('studio:aaa, people:bbb,lixo,:ccc,crm:');
    assert.deepEqual([...m.entries()], [['aaa', 'studio'], ['bbb', 'people']]);
  });
  test('produtoDoToken deduz o produto; sem config nunca autentica', () => {
    const env = { INTERNAL_EMAIL_TOKENS: 'studio:aaa,people:bbb' };
    assert.equal(produtoDoToken('bbb', env), 'people');
    assert.equal(produtoDoToken('zzz', env), null);
    assert.equal(produtoDoToken('', env), null);
    assert.equal(produtoDoToken('aaa', {}), null);
  });
});

describe('routes/email — eventos SES', () => {
  test('bounce permanente suprime; transitório não', () => {
    const perm = interpretarEventoSes({
      eventType: 'Bounce',
      mail: { messageId: 'm1' },
      bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'X@y.com', diagnosticCode: '550' }] },
    });
    assert.equal(perm.status, 'bounce');
    assert.deepEqual(perm.supressoes, [{ email: 'x@y.com', motivo: 'bounce', detalhe: 'General — 550' }]);
    const trans = interpretarEventoSes({ eventType: 'Bounce', mail: { messageId: 'm1' }, bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'x@y.com' }] } });
    assert.deepEqual(trans.supressoes, []);
  });
  test('reclamação suprime; entrega só atualiza status (formato notificationType também)', () => {
    const c = interpretarEventoSes({ notificationType: 'Complaint', mail: { messageId: 'm2' }, complaint: { complainedRecipients: [{ emailAddress: 'a@b.com' }] } });
    assert.equal(c.status, 'reclamacao');
    assert.equal(c.supressoes[0].motivo, 'reclamacao');
    const d = interpretarEventoSes({ eventType: 'Delivery', mail: { messageId: 'm3' } });
    assert.equal(d.status, 'entregue');
    assert.deepEqual(d.supressoes, []);
  });
});

describe('lib/sns — assinatura', () => {
  test('só aceita certificado de sns.*.amazonaws.com via https', () => {
    assert.equal(sns.urlCertificadoValida('https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem'), true);
    assert.equal(sns.urlCertificadoValida('http://sns.us-east-1.amazonaws.com/x.pem'), false);
    assert.equal(sns.urlCertificadoValida('https://sns.us-east-1.amazonaws.com.evil.com/x.pem'), false);
    assert.equal(sns.urlCertificadoValida('https://evil.com/sns.us-east-1.amazonaws.com/x.pem'), false);
  });

  test('verifica assinatura v1 e v2 de uma Notification; adulterada falha', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    // Verificar aceita chave pública PEM no lugar do certificado.
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    const certUrl = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-teste.pem';
    sns._cacheCertificados.set(certUrl, pem);
    for (const versao of ['1', '2']) {
      const msg = {
        Type: 'Notification', MessageId: 'id', TopicArn: 'arn:aws:sns:us-east-1:1:t',
        Message: '{"eventType":"Delivery"}', Timestamp: '2026-10-01T00:00:00.000Z',
        SignatureVersion: versao, SigningCertURL: certUrl,
      };
      const signer = crypto.createSign(versao === '2' ? 'RSA-SHA256' : 'RSA-SHA1');
      signer.update(sns.stringParaAssinar(msg));
      msg.Signature = signer.sign(privateKey, 'base64');
      assert.equal(await sns.assinaturaValida(msg), true);
      assert.equal(await sns.assinaturaValida({ ...msg, Message: '{"eventType":"Bounce"}' }), false);
    }
  });
});
