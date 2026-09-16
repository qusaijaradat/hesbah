import { apiClient } from "./client";
import type {
  SackKindDto, SackLineInput, SackMovementDto, SacksOverviewDto,
} from "../types";

export async function listSackKinds(includeInactive = false) {
  const { data } = await apiClient.get<SackKindDto[]>("/sacks/kinds", { params: { includeInactive } });
  return data;
}

/**
 * Creating a kind is part of using the picker — somebody types a colour that is not on the list and
 * it becomes one. The backend treats a name that already exists as that same kind (and switches it
 * back on if it had been retired), so pressing this twice cannot produce two half-balances for the
 * same sacks.
 */
export async function createSackKind(name: string, stockQuantity = 0) {
  const { data } = await apiClient.post<SackKindDto>("/sacks/kinds", { name, stockQuantity });
  return data;
}

/** Also where the store count is corrected — see SackKind.StockQuantity. */
export async function updateSackKind(id: number, payload: { name: string; isActive: boolean; stockQuantity: number }) {
  const { data } = await apiClient.put<SackKindDto>(`/sacks/kinds/${id}`, payload);
  return data;
}

/** "سحب" — sacks going out, several kinds as ONE event. See the backend request type for why. */
export async function withdrawSacks(payload: {
  partnerId: number; date: string; lines: SackLineInput[]; notes?: string;
}) {
  const { data } = await apiClient.post<SackMovementDto[]>("/sacks/withdrawals", payload);
  return data;
}

/** "ارتجاع" — the same shape, the other direction. */
export async function returnSacks(payload: {
  partnerId: number; date: string; lines: SackLineInput[]; notes?: string;
}) {
  const { data } = await apiClient.post<SackMovementDto[]>("/sacks/returns", payload);
  return data;
}

export async function deleteSackMovement(movementId: number) {
  await apiClient.delete(`/sacks/movements/${movementId}`);
}

export interface SacksFilter {
  dateFrom?: string;
  dateTo?: string;
  partnerId?: number;
}

export async function sacksOverview(filter: SacksFilter) {
  const { data } = await apiClient.get<SacksOverviewDto>("/sacks/overview", { params: filter });
  return data;
}

export async function printSacksOverviewPdf(filter: SacksFilter) {
  const { data } = await apiClient.get("/sacks/overview/print/pdf", { params: filter, responseType: "blob" });
  return data as Blob;
}

/**
 * Corrects one recorded line — its kind, direction, date, count or note. Not the person: a
 * handover recorded against the wrong man is a different event, deleted and recorded again.
 */
export async function updateSackMovement(movementId: number, payload: {
  sackKindId: number | null;
  direction: "Out" | "In";
  date: string;
  quantity: number;
  notes?: string | null;
}) {
  const { data } = await apiClient.put<SackMovementDto>(`/sacks/movements/${movementId}`, payload);
  return data;
}
