import { NavLink } from 'react-router-dom';

// Sub-navegação do módulo Clientes (spec §6: Empresas + Usuários).
export function ClientesTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => 'subtab' + (isActive ? ' ativo' : '');
  return (
    <nav className="subtabs">
      <NavLink to="/clientes" end className={cls}>
        Empresas
      </NavLink>
      <NavLink to="/clientes/usuarios" className={cls}>
        Usuários
      </NavLink>
    </nav>
  );
}
