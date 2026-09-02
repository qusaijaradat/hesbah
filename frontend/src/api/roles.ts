import { apiClient } from "./client";
import type { PermissionDto, RoleDto } from "../types";

export async function listRolesFull() {
  const { data } = await apiClient.get<RoleDto[]>("/roles");
  return data;
}

export async function listAllPermissions() {
  const { data } = await apiClient.get<PermissionDto[]>("/roles/permissions");
  return data;
}

export async function createRole(payload: { name: string; description?: string; permissionKeys: string[] }) {
  const { data } = await apiClient.post<RoleDto>("/roles", payload);
  return data;
}

export async function updateRole(id: number, payload: { name: string; description?: string; permissionKeys: string[] }) {
  const { data } = await apiClient.put<RoleDto>(`/roles/${id}`, payload);
  return data;
}

// Only succeeds server-side on a role with zero users currently assigned to it — see
// RoleService.DeleteAsync's doc comment.
export async function deleteRole(id: number) {
  await apiClient.delete(`/roles/${id}`);
}
