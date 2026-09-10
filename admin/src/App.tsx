import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Placeholder } from './pages/Placeholder';

export function App() {
  const { admin, carregando } = useAuth();
  const loc = useLocation();

  if (carregando) {
    return <div className="tela-cheia muted">Carregando…</div>;
  }

  if (!admin) {
    return loc.pathname === '/login' ? (
      <Login />
    ) : (
      <Navigate to="/login" replace state={{ from: loc.pathname }} />
    );
  }

  if (loc.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route
          path="/clientes/*"
          element={<Placeholder area="Clientes" perm="clientes:read" />}
        />
        <Route
          path="/produtos/*"
          element={<Placeholder area="Produtos" perm="clientes:read" />}
        />
        <Route
          path="/whatsapp/*"
          element={<Placeholder area="WhatsApp" perm="whatsapp:read" />}
        />
        <Route
          path="/campanhas/*"
          element={<Placeholder area="Campanhas" perm="campanha:read" />}
        />
        <Route
          path="/plataforma/*"
          element={<Placeholder area="Plataforma" perm="billing:read" />}
        />
        <Route
          path="/sistema/*"
          element={<Placeholder area="Sistema" perm="auditoria:read" />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
