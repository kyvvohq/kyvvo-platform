import { NavLink } from 'react-router-dom';

export function CampanhasTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => 'subtab' + (isActive ? ' ativo' : '');
  return (
    <nav className="subtabs">
      <NavLink to="/campanhas" end className={cls}>
        Templates
      </NavLink>
      <NavLink to="/campanhas/disparos" className={cls}>
        Disparos
      </NavLink>
    </nav>
  );
}
