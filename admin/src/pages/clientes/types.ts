export interface ClienteLista {
  id: string;
  nome: string;
  whatsapp: string | null;
  telefone: string | null;
  ativo: boolean;
  status: string;
  plano: string | null;
  plano_nome: string;
  criado_em: string;
  ativado_em: string | null;
  responsavel_nome: string | null;
  responsavel_email: string | null;
  total_usuarios: number;
  status_conta: string;
  trial_dias_restantes: number | null;
  whatsapp_conectado: boolean;
}

export interface ClientesResposta {
  clientes: ClienteLista[];
  page: number;
  limit: number;
  total: number;
  total_paginas: number;
}

export interface FiltrosCatalogo {
  planos: { chave: string; nome: string; produto: string }[];
  modulos: { key: string; nome: string }[];
  status: { chave: string; rotulo: string }[];
}

export interface ResumoClientes {
  total: number;
  ativos: number;
  trial: number;
  inativos: number;
  novos_mes: number;
}

export interface UsuarioTenant {
  id: string;
  nome: string | null;
  email: string;
  role: string;
  email_verified: boolean;
  ativo: boolean;
  criado_em: string;
}

export interface Cliente360 {
  id: string;
  nome: string;
  telefone: string | null;
  whatsapp: string | null;
  endereco: string | null;
  segmento: string | null;
  criado_em: string;
  ativado_em: string | null;
  ativo: boolean;
  status: string;
  status_conta: string;
  status_alterado_em: string | null;
  acesso_ate: string | null;
  cancelado_em: string | null;
  trial: {
    ativo: boolean;
    inicio: string | null;
    fim: string | null;
    dias_restantes: number | null;
  };
  plano: { chave: string | null; nome: string };
  billing: {
    asaas_customer_id: string | null;
    asaas_subscription_id: string | null;
    meio_pagamento: string | null;
    cartao_final: string | null;
    cpf_cnpj: string | null;
  };
  whatsapp_conectado: boolean;
  meta_phone_number_id: string | null;
  entitlements: {
    modulos: { key: string; nome: string; obrigatorio: boolean; ativo: boolean }[];
    limites: Record<string, { valor: number | null; unidade: string | null }>;
  };
  usuarios: UsuarioTenant[];
  atividade: { tipo: string; criado_em: string }[];
  produtos: unknown[];
}
