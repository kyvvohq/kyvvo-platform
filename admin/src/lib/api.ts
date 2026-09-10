// Cliente da Admin API (/admin/api/*): injeta o Bearer, faz um refresh
// silencioso no primeiro 401 e, se ainda assim falhar, limpa a sessão e
// manda pro login. Sem lib de data-fetching — as telas usam `api()` direto.

const TOKEN_KEY = 'kyvvo_admin_token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* modo privado / storage bloqueado — sessão só vive em memória do tab */
  }
};
export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Uma tentativa de refresh compartilhada entre requests concorrentes.
let refreshing: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  const token = getToken();
  if (!token) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = fetch('/admin/api/auth/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const body = (await r.json()) as { token?: string };
        if (!body.token) return false;
        setToken(body.token);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const ehAuth = path.startsWith('/auth/');
  const doFetch = () => {
    const token = getToken();
    return fetch(`/admin/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  };

  let res = await doFetch();

  if (res.status === 401 && !ehAuth && getToken()) {
    if (await tryRefresh()) res = await doFetch();
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && !ehAuth) {
      clearToken();
      window.location.assign('/admin/login');
    }
    const msg =
      (body && typeof body === 'object' && (body.error || body.message)) || `Erro ${res.status}`;
    throw new ApiError(res.status, msg);
  }

  return body as T;
}
