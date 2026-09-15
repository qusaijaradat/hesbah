import { apiClient } from "./client";
import type { RoleDto, SessionDto, UserDto } from "../types";

export async function listUsers() {
  const { data } = await apiClient.get<UserDto[]>("/users");
  return data;
}

export async function listRoles() {
  const { data } = await apiClient.get<RoleDto[]>("/users/roles");
  return data;
}

export async function createUser(payload: { fullName: string; username: string; password: string; roleId: number }) {
  const { data } = await apiClient.post<UserDto>("/users", payload);
  return data;
}

export async function updateUser(id: number, payload: { fullName: string; roleId: number; isActive: boolean; newPassword?: string }) {
  const { data } = await apiClient.put<UserDto>(`/users/${id}`, payload);
  return data;
}

/**
 * Where somebody else is signed in, and the two ways to put them out. All three need
 * users.sessions — its own permission, because this is the switch that actually ends access
 * in a system where accounts otherwise stay signed in indefinitely.
 */
export async function listUserSessions(userId: number) {
  const { data } = await apiClient.get<SessionDto[]>(`/users/${userId}/sessions`);
  return data;
}

export async function endUserSession(sessionId: number) {
  await apiClient.delete(`/users/sessions/${sessionId}`);
}

/** Returns how many were live. The "he left today" button. */
export async function endAllUserSessions(userId: number) {
  const { data } = await apiClient.delete<number>(`/users/${userId}/sessions`);
  return data;
}
