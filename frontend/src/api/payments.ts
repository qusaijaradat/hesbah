import { apiClient } from "./client";
import type { CheckClearanceStatus, PagedResult, PaymentDirection, PaymentDto, ExpenseDto } from "../types";

export async function listPayments(params: { partnerId?: number; page?: number; pageSize?: number }) {
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

export async function updateExpense(id: number, payload: { date: string; description: string; amount: number; category?: string; employeeId?: number | null }) {
  const { data } = await apiClient.put<ExpenseDto>(`/expenses/${id}`, payload);
  return data;
}

export async function deleteExpense(id: number) {
  await apiClient.delete(`/expenses/${id}`);
}
