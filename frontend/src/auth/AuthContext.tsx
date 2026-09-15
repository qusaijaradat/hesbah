import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { disablePush } from "../lib/push";
import { login as loginApi, logoutApi } from "../api/auth";
import { AUTH_STORAGE_KEY } from "../api/client";
import type { LoginResponse, UserDto } from "../types";

interface AuthState {
  user: UserDto | null;
  token: string | null;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (key: string) => boolean;
  /** Called once the forced/voluntary password change succeeds — clears the gate without
   * requiring a fresh login (the existing token is still valid for everything else). */
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function readStoredAuth(): LoginResponse | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LoginResponse;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    const stored = readStoredAuth();
    // Restored even when the ACCESS token has lapsed, which it will have by morning. What
    // decides whether somebody is still signed in is the session row on the server, not this
    // timestamp: the first request refreshes the token behind the scenes (see api/client.ts), and
    // only a refusal there sends anybody to the login screen. Checking the timestamp here meant
    // opening the app after lunch put you on /login with a session that was perfectly alive.
    if (stored) {
      setUser(stored.user);
      setToken(stored.token);
      setMustChangePassword(stored.mustChangePassword);
    }
    setIsLoading(false);
  }, []);

  async function login(username: string, password: string) {
    const response = await loginApi(username, password);
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(response));
    setUser(response.user);
    setToken(response.token);
    setMustChangePassword(response.mustChangePassword);
  }

  function logout() {
    // Ends the session on the SERVER, not just here. Forgetting the token locally would leave the
    // row live on the admin's list and the refresh cookie able to mint a new token — signing out
    // has to actually end the session, because ending sessions is how access is controlled here.
    void logoutApi().catch(() => undefined);

    // And takes this device off notifications with it. A counter phone that two people share must
    // not keep telling the next person what the last one was allowed to see — the subscription is
    // per user, so leaving it behind would do exactly that. Fire-and-forget: signing out must not
    // wait on, or be blocked by, a push service.
    void disablePush().catch(() => undefined);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setUser(null);
    setToken(null);
    setMustChangePassword(false);
  }

  function hasPermission(key: string) {
    return user?.permissions?.includes(key) ?? false;
  }

  function markPasswordChanged() {
    setMustChangePassword(false);
    const stored = readStoredAuth();
    if (stored) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...stored, mustChangePassword: false }));
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, mustChangePassword, login, logout, hasPermission, markPasswordChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
