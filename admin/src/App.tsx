import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { RequirePerm } from './components/RequirePerm';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Lista as ClientesLista } from './pages/clientes/Lista';
import { Detalhe as ClienteDetalhe } from './pages/clientes/Detalhe';
import { UsuariosLista } from './pages/usuarios/Lista';
import { ProdutosLista } from './pages/produtos/Lista';
import { Planos as PlataformaPlanos } from './pages/plataforma/Planos';
import { Assinaturas as PlataformaAssinaturas } from './pages/plataforma/Assinaturas';
import { Numeros as WhatsappNumeros } from './pages/whatsapp/Numeros';
import { Eventos as WhatsappEventos } from './pages/whatsapp/Eventos';
import { IaUso as WhatsappIaUso } from './pages/whatsapp/IaUso';
import { NumerosProntos as WhatsappNumerosProntos } from './pages/whatsapp/NumerosProntos';
import { Templates as CampanhasTemplates } from './pages/campanhas/Templates';
import { TemplateEditor } from './pages/campanhas/TemplateEditor';
import { Disparos as CampanhasDisparos } from './pages/campanhas/Disparos';
import { Auditoria as SistemaAuditoria } from './pages/sistema/Auditoria';
import { Flags as SistemaFlags } from './pages/sistema/Flags';
import { Admins as SistemaAdmins } from './pages/sistema/Admins';
import { Config as SistemaConfig } from './pages/sistema/Config';

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
          path="/clientes"
          element={
            <RequirePerm perm="clientes:read">
              <ClientesLista />
            </RequirePerm>
          }
        />
        <Route
          path="/clientes/usuarios"
          element={
            <RequirePerm perm="clientes:read">
              <UsuariosLista />
            </RequirePerm>
          }
        />
        <Route
          path="/clientes/:id"
          element={
            <RequirePerm perm="clientes:read">
              <ClienteDetalhe />
            </RequirePerm>
          }
        />

        <Route
          path="/produtos"
          element={
            <RequirePerm perm="clientes:read">
              <ProdutosLista />
            </RequirePerm>
          }
        />
        <Route
          path="/whatsapp"
          element={
            <RequirePerm perm="whatsapp:read">
              <WhatsappNumeros />
            </RequirePerm>
          }
        />
        <Route
          path="/whatsapp/eventos"
          element={
            <RequirePerm perm="whatsapp:read">
              <WhatsappEventos />
            </RequirePerm>
          }
        />
        <Route
          path="/whatsapp/ia-uso"
          element={
            <RequirePerm perm="whatsapp:read">
              <WhatsappIaUso />
            </RequirePerm>
          }
        />
        <Route
          path="/whatsapp/numeros-prontos"
          element={
            <RequirePerm perm="whatsapp:read">
              <WhatsappNumerosProntos />
            </RequirePerm>
          }
        />
        <Route
          path="/campanhas"
          element={
            <RequirePerm perm="template:read">
              <CampanhasTemplates />
            </RequirePerm>
          }
        />
        <Route
          path="/campanhas/disparos"
          element={
            <RequirePerm perm="campanha:read">
              <CampanhasDisparos />
            </RequirePerm>
          }
        />
        <Route
          path="/campanhas/novo"
          element={
            <RequirePerm perm="template:write">
              <TemplateEditor />
            </RequirePerm>
          }
        />
        <Route
          path="/campanhas/:id"
          element={
            <RequirePerm perm="template:read">
              <TemplateEditor />
            </RequirePerm>
          }
        />
        <Route
          path="/plataforma"
          element={
            <RequirePerm perm="billing:read">
              <PlataformaPlanos />
            </RequirePerm>
          }
        />
        <Route
          path="/plataforma/assinaturas"
          element={
            <RequirePerm perm="billing:read">
              <PlataformaAssinaturas />
            </RequirePerm>
          }
        />
        <Route
          path="/sistema"
          element={
            <RequirePerm perm="auditoria:read">
              <SistemaAuditoria />
            </RequirePerm>
          }
        />
        <Route
          path="/sistema/flags"
          element={
            <RequirePerm perm="flag:read">
              <SistemaFlags />
            </RequirePerm>
          }
        />
        <Route
          path="/sistema/admins"
          element={
            <RequirePerm perm="admin:manage">
              <SistemaAdmins />
            </RequirePerm>
          }
        />
        <Route
          path="/sistema/config"
          element={
            <RequirePerm perm="config:read">
              <SistemaConfig />
            </RequirePerm>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
