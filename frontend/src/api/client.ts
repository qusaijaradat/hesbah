import axios from "axios";

const AUTH_STORAGE_KEY = "gm_auth";

// Default to the same host the page itself was loaded from (just swapping the port to the
// API's 5080) rather than hardcoding "localhost" — that way it keeps working whether the
// app is opened as http://localhost:5173 on the laptop or http://<laptop-LAN-IP>:5173 from
// a phone on the same Wi-Fi, without anyone having to edit .env per device. VITE_API_URL
// still wins if someone sets it explicitly (e.g. pointing at a deployed API).
const inferredApiUrl = `${window.location.protocol}//${window.location.hostname}:5000/api`;

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || inferredApiUrl,
});

// In-memory token cache (never uses browser localStorage per project convention when
// running as a hosted artifact; here we DO use localStorage since this is a real,
// installed web app the market's staff will bookmark and reopen — token persistence
// across page reloads is expected). See auth/AuthContext.tsx for the read/write side.
apiClient.interceptors.request.use((config) => {
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
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export { AUTH_STORAGE_KEY };

export function apiErrorMessage(err: unknown, fallback = "حدث خطأ غير متوقع"): string {
  const anyErr = err as { response?: { data?: { error?: string } } };
  return anyErr?.response?.data?.error ?? fallback;
}
