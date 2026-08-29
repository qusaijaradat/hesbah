import { apiClient } from "./client";
import type { LoginResponse } from "../types";

export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>("/auth/login", { username, password });
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/change-password", { currentPassword, newPassword });
}
