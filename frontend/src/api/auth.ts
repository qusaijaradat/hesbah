import { apiClient } from "./client";
import type { LoginResponse, SessionDto } from "../types";

export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>("/auth/login", { username, password });
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/change-password", { currentPassword, newPassword });
}

/**
 * Ends THIS device's session on the server.
 *
 * Without it, signing out only forgets the token locally: the session row stays live, it
 * still appears on the admin's list of where this person is signed in, and the refresh cookie
 * left in the browser could mint a new access token. Sessions here end because somebody ends
 * them — so signing out has to actually end one.
 */
export async function logoutApi() {
  await apiClient.post("/auth/logout");
}

/** Where this account is signed in. Everyone may see and end their own. */
export async function mySessions() {
  const { data } = await apiClient.get<SessionDto[]>("/auth/sessions");
  return data;
}

export async function endMySession(id: number) {
  await apiClient.delete(`/auth/sessions/${id}`);
}
