import type { ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/useFetch';
import { data, dataHora } from '../../lib/format';
import type { Cliente360 } from './types';

interface BillingResumo {
  status_conta: string;
  plano_nome: string | null;
  valor_plano: number | null;
  proxima_cobranca: string | null;
  meio_pagamento: string | null;
  cartao_final: string | null;
  meio_pagamento_alterado_em: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  cancelado_em: string | null;
}

function brl(v: number | null) {
  return v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function Campo({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="campo">
      <span className="campo-rotulo muted">{rotulo}</span>
      <span className="campo-valor">{valor ?? '—'}</span>
    </div>
  );
}

// Seção Billing da 360°. Os dados básicos (asaas ids, meio de pagamento) já
// vêm no /clientes/:id; o resumo com valor e próxima cobrança sai da Asaas ao
// vivo e por isso é carregado à parte, só pra quem tem billing:read.
export function BillingSecao({ cliente }: { cliente: Cliente360 }) {
  const { pode } = useAuth();
  const { dados: resumo, carregando } = useFetch<BillingResumo>(
    pode('billing:read') ? `/plataforma/assinaturas/${cliente.id}` : null,
  );

  return (
    <section className="painel">
      <h2>Billing</h2>
      <div className="campos">
        {resumo && <Campo rotulo="Valor/mês" valor={brl(resumo.valor_plano)} />}
        {resumo && (
          <Campo
            rotulo="Próxima cobrança"
            valor={resumo.proxima_cobranca ? data(resumo.proxima_cobranca) : '—'}
          />
        )}
        <Campo rotulo="Meio de pagamento" valor={cliente.billing.meio_pagamento} />
        <Campo
          rotulo="Cartão"
          valor={cliente.billing.cartao_final ? `final ${cliente.billing.cartao_final}` : '—'}
        />
        <Campo rotulo="Asaas customer" valor={cliente.billing.asaas_customer_id} />
        <Campo rotulo="Asaas subscription" valor={cliente.billing.asaas_subscription_id} />
        {cliente.status_alterado_em && (
          <Campo rotulo="Status alterado em" valor={dataHora(cliente.status_alterado_em)} />
        )}
      </div>
      {carregando && <p className="muted nota">Consultando a Asaas…</p>}
    </section>
  );
}
