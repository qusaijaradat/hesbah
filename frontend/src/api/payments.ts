import { apiClient } from "./client";
import type { CheckClearanceStatus, PagedResult, PartnerBalancesDto, PaymentDirection, PaymentDto, ExpenseDto } from "../types";

/** `invoiceId` narrows to one invoice's own payments — several rows for one invoice is normal,
 * since a payment split across methods (and a check payment split across several checks) is
 * stored as one row per check/method. Backs the invoice edit page's payments section. */
export async function listPayments(params: { partnerId?: number; invoiceId?: number; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<PaymentDto>>("/payments", { params });
  return data;
}

/** "الشيكات" page — every payment recorded as a check, soonest-due first. */
export async function listChecks(params: { status?: CheckClearanceStatus; dueFrom?: string; dueTo?: string; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<PaymentDto>>("/payments/checks", { params });
  return data;
}

/** "الشيكات" print button — same status/dueFrom/dueTo filters as listChecks above, rendered as one
 * printable PDF (see ExportService.GenerateChecksPdf). `periodLabel` is just descriptive text
 * ("شهر 2026-08") shown on the printed header — it doesn't affect which rows are included. */
export async function printChecksPdf(params: { status?: CheckClearanceStatus; dueFrom?: string; dueTo?: string; periodLabel?: string }) {
  const { data } = await apiClient.get("/payments/checks/print/pdf", { params, responseType: "blob" });
  return data as Blob;
}

export async function createPayment(payload: {
  partnerId?: number; partnerName?: string; direction: PaymentDirection; amount: number; date: string; method?: string; notes?: string; invoiceId?: number | null;
  checkDueDate?: string | null; checkNumber?: string | null;
}) {
  const { data } = await apiClient.post<PaymentDto>("/payments", payload);
  return data;
}

export async function updatePayment(id: number, payload: {
  amount: number; date: string; method?: string; notes?: string; invoiceId?: number | null;
  checkDueDate?: string | null; checkNumber?: string | null; checkStatus?: CheckClearanceStatus | null; checkClearedDate?: string | null;
}) {
  const { data } = await apiClient.put<PaymentDto>(`/payments/${id}`, payload);
  return data;
}

export async function deletePayment(id: number) {
  await apiClient.delete(`/payments/${id}`);
}

/** "الدفعات" tab print button — same optional date range as listPayments, rendered as one printable
 * PDF (see ExportService.GeneratePaymentsListPdf). */
export async function printPaymentsListPdf(params: { from?: string; to?: string }) {
  const { data } = await apiClient.get("/payments/print/pdf", { params, responseType: "blob" });
  return data as Blob;
}

export async function listExpenses(params: { from?: string; to?: string; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<ExpenseDto>>("/expenses", { params });
  return data;
}

/** "مصاريف الحسبة" tab print button — same optional date range as listExpenses, rendered as one
 * printable PDF (see ExportService.GenerateExpensesListPdf). */
export async function printExpensesPdf(params: { from?: string; to?: string }) {
  const { data } = await apiClient.get("/expenses/print/pdf", { params, responseType: "blob" });
  return data as Blob;
}

export async function createExpense(payload: { date: string; description: string; amount: number; category?: string; employeeId?: number | null }) {
  const { data } = await apiClient.post<ExpenseDto>("/expenses", payload);
  return data;
}

/**
 * "سند قبض" — the proof a buyer, a seller or a driver asks for that a payment happened.
 *
 * Two identical copies on the sheet, one for each side, with a cut line between them. Optional
 * by design: there is a button on the row and nothing is printed unless somebody asks for it.
 */
export async function printPaymentReceiptPdf(id: number) {
  const { data } = await apiClient.get(`/payments/${id}/receipt/pdf`, { responseType: "blob" });
  return data as Blob;
}

/**
 * The same slip for an expense — money out of the till, signed for by whoever took it.
 *
 * Two identical copies on the sheet, one for each side, with a cut line between them. Printing
 * an old one again is just reading, so it is gated on إظهار المصاريف rather than on creating.
 */
export async function printExpenseReceiptPdf(id: number) {
  const { data } = await apiClient.get(`/expenses/${id}/receipt/pdf`, { responseType: "blob" });
  return data as Blob;
}

export async function updateExpense(id: number, payload: { date: string; description: string; amount: number; category?: string; employeeId?: number | null }) {
  const { data } = await apiClient.put<ExpenseDto>(`/expenses/${id}`, payload);
  return data;
}

export async function deleteExpense(id: number) {
  await apiClient.delete(`/expenses/${id}`);
}

/**
 * Both sides of one person: what he owes the market as a buyer, what the market owes him as a
 * seller, and how much of the two can be settled against each other.
 *
 * Read server-side off the same two account pages the app already shows — never worked out here.
 */
export async function partnerBalances(partnerId: number) {
  const { data } = await apiClient.get<PartnerBalancesDto>(`/payments/balances/${partnerId}`);
  return data;
}

/**
 * "تسوية" — an amount written straight onto somebody's account.
 *
 * Writes an ordinary payment per account the person actually has, and returns them: one row for
 * most people, two for the man who sells in the morning and buys in the afternoon. No cash moves,
 * and there is no ceiling — see the backend's CreateSettlementAsync for why both limits went.
 */
export async function createSettlement(payload: { partnerId: number; amount: number; date: string; notes?: string }) {
  const { data } = await apiClient.post<PaymentDto[]>("/payments/settlement", payload);
  return data;
}
