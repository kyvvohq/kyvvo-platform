// Navegação de 1º nível (spec §4). `perms` = qualquer uma libera o item;
// ausente = sempre visível pra quem está logado. O detalhe de cada área
// vem nas fases seguintes; aqui os alvos abrem telas-stub.

export interface NavItem {
  to: string;
  label: string;
  perms?: string[];
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Visão geral' },
  { to: '/clientes', label: 'Clientes', perms: ['clientes:read'] },
  { to: '/produtos', label: 'Produtos', perms: ['clientes:read', 'plano:alterar'] },
  { to: '/whatsapp', label: 'WhatsApp', perms: ['whatsapp:read'] },
  { to: '/campanhas', label: 'Campanhas', perms: ['campanha:read'] },
  { to: '/plataforma', label: 'Plataforma', perms: ['billing:read'] },
  { to: '/sistema', label: 'Sistema', perms: ['auditoria:read', 'flag:read', 'admin:manage'] },
];
