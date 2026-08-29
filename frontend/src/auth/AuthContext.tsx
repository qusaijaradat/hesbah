import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { login as loginApi } from "../api/auth";
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
    if (stored && new Date(stored.expiresAt).getTime() > Date.now()) {
      setUser(stored.user);
      setToken(stored.token);
      setMustChangePassword(stored.mustChangePassword);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
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
