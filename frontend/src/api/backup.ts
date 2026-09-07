import { apiClient } from "./client";

/** "نسخة احتياطية" — the whole database as a ZIP of CSVs, one per table. A complete data
 * export (soft-deleted rows included) that a technician can reload and an owner can open in
 * Excel; NOT a pg_dump — see backend BackupService for exactly what it does and doesn't carry. */
export async function downloadBackup() {
  const { data } = await apiClient.get("/backup/download", { responseType: "blob" });
  return data as Blob;
}
