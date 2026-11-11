"use client";

// Dual-layer session transport: in-memory + localStorage fallback.
// In iframe previews where cookies and/or localStorage might be partitioned or blocked,
// the in-memory token guarantees the session persists throughout all API calls.

export const TOKEN_KEY = "dba_session_token";
export const UNAUTHORIZED_EVENT = "dba:unauthorized";

let inMemoryToken: string | null = null;

export function getToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) {
      inMemoryToken = stored;
      return stored;
    }
  } catch {
    /* private/partitioned storage blocked */
  }
  return null;
}

export function setToken(token: string | null) {
  inMemoryToken = token;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* storage blocked */
  }
}

export function clearToken() {
  inMemoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
}

let originalFetch: typeof window.fetch | null = null;

export function installFetchInterceptor() {
  if (typeof window === "undefined") return () => {};
  if (originalFetch) window.fetch = originalFetch;
  originalFetch = window.fetch.bind(window);
  const original = originalFetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isApi = url.includes("/api/");
    const token = getToken();
    let nextInit = init;

    if (isApi && token) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
      if (!headers.has("x-dba-session")) headers.set("x-dba-session", token);
      nextInit = { ...(init ?? {}), headers };
    }

    const response = await original(input, nextInit);
    const isAuthGet = /\/api\/v1\/auth(\?|$)/.test(url) && !(init?.method);
    if (isAuthGet && response.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return response;
  };

  return () => {
    if (originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
    }
  };
}
