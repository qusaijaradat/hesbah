import { apiClient } from "./client";
import type { RoleDto, UserDto } from "../types";

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
