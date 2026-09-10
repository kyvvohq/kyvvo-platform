import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

export interface FetchState<T> {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
}

// Fetch declarativo pros GETs da Admin API. `path` null = não busca (útil pra
// rotas que dependem de um id que ainda não chegou). Muda o `path` → refaz.
export function useFetch<T>(path: string | null): FetchState<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(path !== null);
  const [erro, setErro] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recarregar = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (path === null) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    api<T>(path)
      .then((d) => {
        if (vivo) setDados(d);
      })
      .catch((e) => {
        if (vivo) setErro(e instanceof ApiError ? e.message : 'Erro ao carregar.');
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [path, tick]);

  return { dados, carregando, erro, recarregar };
}
