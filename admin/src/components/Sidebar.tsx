import { NavLink } from 'react-router-dom';
import { NAV } from '../lib/nav';
import { useAuth } from '../lib/auth';

export function Sidebar() {
  const { pode } = useAuth();
  const itens = NAV.filter((i) => !i.perms || pode(...i.perms));

  return (
    <aside className="sidebar">
      <div className="sidebar-marca">
        <span className="sidebar-logo">kyvvo</span>
        <span className="sidebar-tag">admin</span>
      </div>
      <nav className="sidebar-nav">
        {itens.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) => 'sidebar-link' + (isActive ? ' ativo' : '')}
          >
            {i.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
