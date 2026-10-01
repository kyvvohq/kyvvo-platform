// Verificação de assinatura das mensagens HTTP do Amazon SNS — o webhook
// /webhook/ses é público, então só aceita o que vier assinado pela AWS.
// Algoritmo: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

const crypto = require('crypto');

const CAMPOS_NOTIFICACAO = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
const CAMPOS_ASSINATURA = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

// Só certificados servidos pelo próprio SNS (senão qualquer um assina com um
// certificado próprio hospedado onde quiser).
function urlCertificadoValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:'
      && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname)
      && u.pathname.endsWith('.pem');
  } catch {
    return false;
  }
}

function urlSnsValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname);
  } catch {
    return false;
  }
}

function stringParaAssinar(msg) {
  const campos = msg.Type === 'Notification' ? CAMPOS_NOTIFICACAO : CAMPOS_ASSINATURA;
  return campos
    .filter((c) => msg[c] !== undefined && msg[c] !== null)
    .map((c) => `${c}\n${msg[c]}\n`)
    .join('');
}

const cacheCertificados = new Map();
async function baixarCertificado(url, fetchImpl) {
  if (cacheCertificados.has(url)) return cacheCertificados.get(url);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`certificado SNS respondeu ${res.status}`);
  const pem = await res.text();
  cacheCertificados.set(url, pem);
  return pem;
}

// Resolve true/false; nunca lança.
async function assinaturaValida(msg, { fetchImpl = globalThis.fetch } = {}) {
  try {
    if (!msg || !msg.Signature || !msg.SigningCertURL) return false;
    if (!urlCertificadoValida(msg.SigningCertURL)) return false;
    const algoritmo = String(msg.SignatureVersion) === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
    const pem = await baixarCertificado(msg.SigningCertURL, fetchImpl);
    const verificador = crypto.createVerify(algoritmo);
    verificador.update(stringParaAssinar(msg), 'utf8');
    return verificador.verify(pem, msg.Signature, 'base64');
  } catch {
    return false;
  }
}

module.exports = {
  assinaturaValida,
  stringParaAssinar,
  urlCertificadoValida,
  urlSnsValida,
  _cacheCertificados: cacheCertificados,
};
