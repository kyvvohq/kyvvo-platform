import { NavLink } from 'react-router-dom';

export function PlataformaTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => 'subtab' + (isActive ? ' ativo' : '');
  return (
    <nav className="subtabs">
      <NavLink to="/plataforma" end className={cls}>
        Planos
      </NavLink>
      <NavLink to="/plataforma/assinaturas" className={cls}>
        Assinaturas
      </NavLink>
    </nav>
  );
}
