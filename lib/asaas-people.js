// Cliente Asaas do People = @kyvvohq/asaas com `produtoNome` fixo em
// 'Kyvvo People' — mesmo wrapper que existia em kyvvo-people/lib/asaas.js,
// portado verbatim (mesma conta Asaas compartilhada com o Studio, só muda o
// nome do produto na `description` da subscription).
const base = require('@kyvvohq/asaas');

module.exports = {
  ...base,
  criarSubscription: (args) => base.criarSubscription({ produtoNome: 'Kyvvo People', ...args }),
  atualizarSubscription: (args) => base.atualizarSubscription({ produtoNome: 'Kyvvo People', ...args }),
};
