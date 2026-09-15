import axios from "axios";
import { loadingStore } from "../lib/loadingStore";

const AUTH_STORAGE_KEY = "gm_auth";

// Same origin as the page, always. In production nginx serves the app and proxies /api to the
// API container; in development Vite proxies it to :5080 (see vite.config.ts). It used to point
// straight at :5080, which was a different origin — and a different origin is one a browser will
// not send a SameSite=Strict cookie to, which is what the refresh token is. VITE_API_URL still
// wins if somebody points this at a deployed API on purpose.
const sameOriginApiUrl = "/api";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || sameOriginApiUrl,
  // The refresh cookie. httpOnly, so nothing here can read it — it only has to be SENT, and for a
  // cross-origin VITE_API_URL it would not be without this.
  withCredentials: true,
});

/**
 * One refresh at a time.
 *
 * A page that opens with five requests gets five 401s at once when the access token has lapsed.
 * Without this they would each refresh, and refreshing ROTATES the token — four of the five would
 * be presenting one that had just been retired, which the server reads as a stolen token and
 * answers by ending the session. The fix for an expired token would be getting signed out.
 */
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    // Bare axios, not apiClient: this must not pass back through the interceptors below and
    // recurse, and it must not add a second tick to the loading bar for a request nobody made.
    const { data } = await axios.post(
      `${apiClient.defaults.baseURL}/auth/refresh`, null, { withCredentials: true });
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    return data.token as string;
  } catch {
    return null;
  }
}

// In-memory token cache (never uses browser localStorage per project convention when
// running as a hosted artifact; here we DO use localStorage since this is a real,
// installed web app the market's staff will bookmark and reopen — token persistence
// across page reloads is expected). See auth/AuthContext.tsx for the read/write side.
// Every request through this client bumps the global loading counter (see lib/loadingStore.ts +
// components/GlobalLoadingBar.tsx) so the whole app shows the same "something is loading" cue —
// no page has to wire up its own spinner just to get that. finish() is called exactly once per
// start(), whether the request ultimately succeeds or fails, from the matching branch below.
apiClient.interceptors.request.use(
  (config) => {
    loadingStore.start();
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      try {
        const { token } = JSON.parse(raw);
        if (token) config.headers.Authorization = `Bearer ${token}`;
      } catch {
        // ignore malformed storage
      }
    }
    return config;
  },
  (error) => {
    loadingStore.finish();
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => {
    loadingStore.finish();
    return response;
  },
  async (error) => {
    loadingStore.finish();
    if (error?.response?.status !== 401) return Promise.reject(error);

    const config = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const url: string = config?.url ?? "";
    // Never on the auth endpoints themselves. login failing is a wrong password, and refresh
    // failing is the session being over — retrying either is a loop.
    const isAuthCall = url.includes("/auth/login") || url.includes("/auth/refresh");

    if (config && !config._retried && !isAuthCall) {
      config._retried = true;
      refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
      const token = await refreshing;
      if (token) {
        // Straight back through apiClient, which re-reads the token storage that was just
        // updated. From the caller's side nothing happened but a slower request.
        return apiClient(config);
      }
    }

    // No session left. This is the only path that signs somebody out, and it is reached only
    // after a refresh was tried and refused.
    localStorage.removeItem(AUTH_STORAGE_KEY);
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export { AUTH_STORAGE_KEY };

export function apiErrorMessage(err: unknown, fallback = "حدث خطأ غير متوقع"): string {
  const anyErr = err as { response?: { data?: { error?: string } } };
  return anyErr?.response?.data?.error ?? fallback;
}
