import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface Hit {
  tipo: string;
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

// Busca global (spec §14) — federada: empresas, usuários, telefones/PNID.
// Debounce curto, dropdown clicável, fecha ao clicar fora.
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [aberto, setAberto] = useState(false);
  const nav = useNavigate();
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ resultados: Hit[] }>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setHits(r.resultados);
          setAberto(true);
        })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  function ir(href: string) {
    setAberto(false);
    setQ('');
    setHits([]);
    nav(href);
  }

  const mostrarVazio = aberto && q.trim().length >= 2 && hits.length === 0;

  return (
    <div className="busca-global" ref={caixa}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length > 0 && setAberto(true)}
        placeholder="Buscar empresa, usuário, telefone…"
        aria-label="Busca global"
      />
      {aberto && hits.length > 0 && (
        <ul className="busca-resultados">
          {hits.map((h) => (
            <li key={`${h.tipo}-${h.id}`}>
              <button type="button" onClick={() => ir(h.href)}>
                <span className="busca-label">{h.label}</span>
                <span className="busca-sub muted">{h.sublabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {mostrarVazio && (
        <ul className="busca-resultados">
          <li className="busca-vazio muted">Nada encontrado</li>
        </ul>
      )}
    </div>
  );
}
