import { apiClient } from "./client";
import type { LedgerMigrationPreviewDto, LedgerMigrationResultDto } from "../types";

/**
 * The one-time "move the produce money onto the drivers" migration.
 *
 * `preview` writes nothing and can be called as often as the screen likes; the other two move real
 * money across every seller and driver account at once, which is why they take no arguments — there
 * is nothing to configure, only whether to do it.
 */
export async function previewLedgerMigration() {
  const { data } = await apiClient.get("/ledger-migration/preview");
  return data as LedgerMigrationPreviewDto;
}

export async function runLedgerMigration() {
  const { data } = await apiClient.post("/ledger-migration/run");
  return data as LedgerMigrationResultDto;
}

export async function undoLedgerMigration() {
  const { data } = await apiClient.post("/ledger-migration/undo");
  return data as LedgerMigrationResultDto;
}
