import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-corpo">
        <Topbar />
        <main className="shell-conteudo">{children}</main>
      </div>
    </div>
  );
}
