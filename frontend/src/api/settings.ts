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

/**
 * The uploaded company logo (Settings → "الشعار"), fetched as a blob rather than pointed to
 * directly from an <img src=...> — the endpoint sits behind the same Bearer-token auth as every
 * other API call, which a plain <img> tag has no way to send. Returns null when no logo has been
 * uploaded yet (backend replies 204 No Content).
 */
export async function getLogo(): Promise<Blob | null> {
  const { data, status } = await apiClient.get("/settings/logo", { responseType: "blob" });
  if (status === 204) return null;
  return data as Blob;
}

export async function uploadLogo(file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  await apiClient.post("/settings/logo", formData, { headers: { "Content-Type": "multipart/form-data" } });
}

export async function deleteLogo(): Promise<void> {
  await apiClient.delete("/settings/logo");
}
