import { apiClient } from "./client";
import type {
  PartnerDto, PartnerSuggestionDto, PagedResult, PartnerType,
  MerchantAccountDto, FarmerAccountDto, DebtsOverviewDto, PartnerInvoiceDetailDto,
  PartnerContainersDto, ContainerMovementDto, CreateContainerMovementRequest, AdjustmentDto,
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

export async function createPartner(payload: { name: string; type: PartnerType | null; whatsAppNumber?: string; address?: string; notes?: string; creditLimit?: number | null; openingBalance?: number | null }) {
  const { data } = await apiClient.post<PartnerDto>("/partners", payload);
  return data;
}

export async function updatePartner(id: number, payload: { name: string; type: PartnerType | null; whatsAppNumber?: string; address?: string; notes?: string; creditLimit?: number | null; openingBalance?: number | null }) {
  const { data } = await apiClient.put<PartnerDto>(`/partners/${id}`, payload);
  return data;
}

export async function getMerchantAccount(id: number) {
  const { data } = await apiClient.get<MerchantAccountDto>(`/partners/${id}/merchant-account`);
  return data;
}

/** "كشف حساب" print button on the مشتري account page — same numbers as getMerchantAccount above,
 * rendered as one printable PDF (see ExportService.GenerateAccountStatementPdf). */
export async function printMerchantAccountPdf(id: number) {
  const { data } = await apiClient.get(`/partners/${id}/merchant-account/print/pdf`, { responseType: "blob" });
  return data as Blob;
}

export async function getFarmerAccount(id: number) {
  const { data } = await apiClient.get<FarmerAccountDto>(`/partners/${id}/farmer-account`);
  return data;
}

/** بائع/سائق-side counterpart of printMerchantAccountPdf above. */
export async function printFarmerAccountPdf(id: number) {
  const { data } = await apiClient.get(`/partners/${id}/farmer-account/print/pdf`, { responseType: "blob" });
  return data as Blob;
}

export async function getDebtsOverview() {
  const { data } = await apiClient.get<DebtsOverviewDto>("/partners/debts-overview");
  return data;
}

/** "قيمة الديون" print button — same 3 sections/numbers as getDebtsOverview above, rendered as one
 * printable PDF (see ExportService.GenerateDebtsOverviewPdf). */
export async function printDebtsOverviewPdf() {
  const { data } = await apiClient.get("/partners/debts-overview/print/pdf", { responseType: "blob" });
  return data as Blob;
}

/** "قيمة الديون" drill-down (بائع/سائق side) — every item line off every one of this partner's own
 * invoices, all-time, so the amount on the debts overview is traceable back to exactly which
 * invoices/items/quantities/prices make it up. */
export async function getFarmerInvoiceDetail(id: number) {
  const { data } = await apiClient.get<PartnerInvoiceDetailDto>(`/partners/${id}/farmer-invoice-detail`);
  return data;
}

/** "قيمة الديون" drill-down print button — same lines as getFarmerInvoiceDetail above, rendered as
 * one printable PDF (see ExportService.GenerateInvoiceDetailPdf). */
export async function printFarmerInvoiceDetailPdf(id: number) {
  const { data } = await apiClient.get(`/partners/${id}/farmer-invoice-detail/print/pdf`, { responseType: "blob" });
  return data as Blob;
}

/** مشتري-side counterpart of getFarmerInvoiceDetail above. */
export async function getMerchantInvoiceDetail(id: number) {
  const { data } = await apiClient.get<PartnerInvoiceDetailDto>(`/partners/${id}/merchant-invoice-detail`);
  return data;
}

/** مشتري-side counterpart of printFarmerInvoiceDetailPdf above. */
export async function printMerchantInvoiceDetailPdf(id: number) {
  const { data } = await apiClient.get(`/partners/${id}/merchant-invoice-detail/print/pdf`, { responseType: "blob" });
  return data as Blob;
}

// Only succeeds server-side on a partner with zero invoices/payments/ledger history — see
// PartnerService.DeleteAsync's doc comment.
export async function deletePartner(id: number) {
  await apiClient.delete(`/partners/${id}`);
}

// "الصناديق والمخالات" — empty containers the market lends out, counted per person and per kind,
// for buyers, sellers and drivers alike. Deliberately no money anywhere: see the backend
// IContainerService.
export async function getPartnerContainers(partnerId: number) {
  const { data } = await apiClient.get<PartnerContainersDto>(`/partners/${partnerId}/containers`);
  return data;
}

export async function createContainerMovement(partnerId: number, payload: CreateContainerMovementRequest) {
  const { data } = await apiClient.post<ContainerMovementDto>(`/partners/${partnerId}/containers`, payload);
  return data;
}

export async function deleteContainerMovement(movementId: number) {
  await apiClient.delete(`/partners/containers/${movementId}`);
}

/**
 * "تسوية/تعويض" on a seller's or driver's account — see the backend
 * PartnerService.CreateAdjustmentAsync. `amount` is signed: positive means the market owes this
 * person more (compensating a seller whose item's price collapsed), negative means less.
 */
export async function createAdjustment(partnerId: number, payload: { amount: number; reason: string }) {
  const { data } = await apiClient.post<AdjustmentDto>(`/partners/${partnerId}/adjustments`, payload);
  return data;
}
