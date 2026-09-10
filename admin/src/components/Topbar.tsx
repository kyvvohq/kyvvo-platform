import { useAuth } from '../lib/auth';
import { GlobalSearch } from './GlobalSearch';

export function Topbar() {
  const { admin, sair } = useAuth();
  const rotulo = admin?.nome || admin?.email || 'admin';

  return (
    <header className="topbar">
      <GlobalSearch />
      <div className="topbar-conta">
        <span className="topbar-admin" title={admin?.email}>
          {rotulo}
        </span>
        <button type="button" className="btn-sair" onClick={sair}>
          Sair
        </button>
      </div>
    </header>
  );
}
