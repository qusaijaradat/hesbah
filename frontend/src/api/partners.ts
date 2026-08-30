import { apiClient } from "./client";
import type {
  PartnerDto, PartnerSuggestionDto, PagedResult, PartnerType,
  MerchantAccountDto, FarmerAccountDto,
} from "../types";

export async function listPartners(params: { search?: string; type?: PartnerType; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<PartnerDto>>("/partners", { params });
  return data;
}

// A blank query is intentionally still sent (not short-circuited to []) — the backend
// returns a full pick-list in that case, which is what lets the field behave like a real
// dropdown as soon as it's focused, before anything has been typed.
// `types` optionally restricts the list to specific partner types (e.g. the invoice's
// "بائع / سائق" field only wants Farmer/Driver/Both, not Merchant).
export async function suggestPartners(query: string, types?: PartnerType[]) {
  const { data } = await apiClient.get<PartnerSuggestionDto[]>("/partners/suggest", {
    params: { q: query || undefined, types: types && types.length > 0 ? types.join(",") : undefined },
  });
  return data;
}

export async function getPartner(id: number) {
  const { data } = await apiClient.get<PartnerDto>(`/partners/${id}`);
  return data;
}

export async function createPartner(payload: { name: string; type: PartnerType | null; whatsAppNumber?: string; notes?: string; creditLimit?: number | null }) {
  const { data } = await apiClient.post<PartnerDto>("/partners", payload);
  return data;
}

export async function updatePartner(id: number, payload: { name: string; type: PartnerType | null; whatsAppNumber?: string; notes?: string; creditLimit?: number | null }) {
  const { data } = await apiClient.put<PartnerDto>(`/partners/${id}`, payload);
  return data;
}

export async function getMerchantAccount(id: number) {
  const { data } = await apiClient.get<MerchantAccountDto>(`/partners/${id}/merchant-account`);
  return data;
}

export async function getFarmerAccount(id: number) {
  const { data } = await apiClient.get<FarmerAccountDto>(`/partners/${id}/farmer-account`);
  return data;
}
