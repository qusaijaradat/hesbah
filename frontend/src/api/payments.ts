import { apiClient } from "./client";
import type { PagedResult, PaymentDirection, PaymentDto, ExpenseDto } from "../types";

export async function listPayments(params: { partnerId?: number; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<PaymentDto>>("/payments", { params });
  return data;
}

export async function createPayment(payload: {
  partnerId?: number; partnerName?: string; direction: PaymentDirection; amount: number; date: string; method?: string; notes?: string; invoiceId?: number | null;
}) {
  const { data } = await apiClient.post<PaymentDto>("/payments", payload);
  return data;
}

export async function updatePayment(id: number, payload: {
  amount: number; date: string; method?: string; notes?: string; invoiceId?: number | null;
}) {
  const { data } = await apiClient.put<PaymentDto>(`/payments/${id}`, payload);
  return data;
}

export async function deletePayment(id: number) {
  await apiClient.delete(`/payments/${id}`);
}

export async function listExpenses(params: { from?: string; to?: string; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<ExpenseDto>>("/expenses", { params });
  return data;
}

export async function createExpense(payload: { date: string; description: string; amount: number; category?: string }) {
  const { data } = await apiClient.post<ExpenseDto>("/expenses", payload);
  return data;
}

export async function updateExpense(id: number, payload: { date: string; description: string; amount: number; category?: string }) {
  const { data } = await apiClient.put<ExpenseDto>(`/expenses/${id}`, payload);
  return data;
}

export async function deleteExpense(id: number) {
  await apiClient.delete(`/expenses/${id}`);
}
