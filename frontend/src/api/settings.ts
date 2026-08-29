import { apiClient } from "./client";
import type { SettingDto } from "../types";

export async function listSettings() {
  const { data } = await apiClient.get<SettingDto[]>("/settings");
  return data;
}

export async function updateSetting(key: string, value: string) {
  const { data } = await apiClient.put<SettingDto>(`/settings/${key}`, { value });
  return data;
}
