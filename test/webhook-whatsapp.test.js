const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  decidirDestino,
  extrairPhoneNumberId,
  classificarEvento,
} = require('../routes/webhook-whatsapp');

const ENV_PADRAO = {
  PEOPLE_PHONE_NUMBER_ID: '111222333',
  PEOPLE_WEBHOOK_URL: 'https://people.kyvvo.com.br/people/webhooks/whatsapp',
  STUDIO_WEBHOOK_URL: 'https://studio.kyvvo.com.br/webhook/whatsapp',
};

test('decidirDestino: phone_number_id do People -> URL do People', () => {
  assert.equal(decidirDestino('111222333', ENV_PADRAO), ENV_PADRAO.PEOPLE_WEBHOOK_URL);
});

test('decidirDestino: qualquer outro phone_number_id (tenant do Studio) -> URL do Studio', () => {
  assert.equal(decidirDestino('999888777', ENV_PADRAO), ENV_PADRAO.STUDIO_WEBHOOK_URL);
});

test('decidirDestino: sem phone_number_id (evento sem mensagem) cai no Studio, nunca descarta', () => {
  assert.equal(decidirDestino(undefined, ENV_PADRAO), ENV_PADRAO.STUDIO_WEBHOOK_URL);
});

test('decidirDestino: sem PEOPLE_PHONE_NUMBER_ID configurado, tudo cai no Studio (nunca confunde com People por acidente)', () => {
  const env = { ...ENV_PADRAO, PEOPLE_PHONE_NUMBER_ID: undefined };
  assert.equal(decidirDestino('111222333', env), ENV_PADRAO.STUDIO_WEBHOOK_URL);
});

test('decidirDestino: sem STUDIO_WEBHOOK_URL configurado, devolve null (evento descartado, não quebra)', () => {
  const env = { ...ENV_PADRAO, STUDIO_WEBHOOK_URL: undefined };
  assert.equal(decidirDestino('999888777', env), null);
});

test('extrairPhoneNumberId: payload real da Meta', () => {
  const body = { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'abc123' } } }] }] };
  assert.equal(extrairPhoneNumberId(body), 'abc123');
});

test('extrairPhoneNumberId: evento sem mensagem (ex.: status de entrega) não lança, devolve undefined', () => {
  assert.equal(extrairPhoneNumberId({ entry: [{ changes: [{ value: {} }] }] }), undefined);
  assert.equal(extrairPhoneNumberId({}), undefined);
  assert.equal(extrairPhoneNumberId(null), undefined);
});

const evt = (value) => ({ entry: [{ changes: [{ value }] }] });

test('classificarEvento: payload com messages[] -> mensagem', () => {
  const { tipo } = classificarEvento(evt({ messages: [{ id: 'wamid.1' }] }));
  assert.equal(tipo, 'mensagem');
});

test('classificarEvento: payload com statuses[] -> status (+ expõe o value)', () => {
  const { tipo, value } = classificarEvento(evt({ statuses: [{ id: 'wamid.1', status: 'delivered' }] }));
  assert.equal(tipo, 'status');
  assert.equal(value.statuses[0].status, 'delivered');
});

test('classificarEvento: payload vazio / desconhecido -> outro', () => {
  assert.equal(classificarEvento({}).tipo, 'outro');
  assert.equal(classificarEvento(evt({})).tipo, 'outro');
});
