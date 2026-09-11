import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function SistemaTabs() {
  const { pode } = useAuth();
  const cls = ({ isActive }: { isActive: boolean }) => 'subtab' + (isActive ? ' ativo' : '');
  return (
    <nav className="subtabs">
      {pode('auditoria:read') && (
        <NavLink to="/sistema" end className={cls}>
          Auditoria
        </NavLink>
      )}
      {pode('flag:read') && (
        <NavLink to="/sistema/flags" className={cls}>
          Feature flags
        </NavLink>
      )}
      {pode('config:read') && (
        <NavLink to="/sistema/config" className={cls}>
          Configurações
        </NavLink>
      )}
      {pode('admin:manage') && (
        <NavLink to="/sistema/admins" className={cls}>
          Admins
        </NavLink>
      )}
    </nav>
  );
}
