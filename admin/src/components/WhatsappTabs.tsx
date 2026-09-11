import { NavLink } from 'react-router-dom';

export function WhatsappTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => 'subtab' + (isActive ? ' ativo' : '');
  return (
    <nav className="subtabs">
      <NavLink to="/whatsapp" end className={cls}>
        Números
      </NavLink>
      <NavLink to="/whatsapp/eventos" className={cls}>
        Eventos
      </NavLink>
      <NavLink to="/whatsapp/ia-uso" className={cls}>
        IA
      </NavLink>
    </nav>
  );
}
