import { apiClient } from "./client";
import type { InvoiceDto, InvoiceFilter, InvoiceItemInput, InvoiceListItemDto, PagedResult } from "../types";

export async function listInvoices(filter: InvoiceFilter) {
  const { data } = await apiClient.get<PagedResult<InvoiceListItemDto>>("/invoices", { params: filter });
  return data;
}

export async function getInvoice(id: number) {
  const { data } = await apiClient.get<InvoiceDto>(`/invoices/${id}`);
  return data;
}

export async function createInvoice(payload: {
  date: string;
  merchantId?: number; merchantName?: string;
  farmerId?: number; farmerName?: string;
  items: InvoiceItemInput[];
}) {
  const { data } = await apiClient.post<InvoiceDto>("/invoices", payload);
  return data;
}

export async function updateInvoice(id: number, payload: {
  date: string;
  merchantId?: number; merchantName?: string;
  farmerId?: number; farmerName?: string;
  items: InvoiceItemInput[];
}) {
  const { data } = await apiClient.put<InvoiceDto>(`/invoices/${id}`, payload);
  return data;
}

export async function cancelInvoice(id: number, reason: string) {
  const { data } = await apiClient.post<InvoiceDto>(`/invoices/${id}/cancel`, { reason });
  return data;
}

export async function downloadInvoicePdf(id: number, thermal: boolean) {
  const { data } = await apiClient.get(`/invoices/${id}/pdf`, { params: { thermal }, responseType: "blob" });
  return data as Blob;
}

export async function downloadInvoicesExcel(filter: InvoiceFilter) {
  const { data } = await apiClient.get("/invoices/export/excel", { params: filter, responseType: "blob" });
  return data as Blob;
}

// Built as a plain query string (not axios's array-params handling) because ASP.NET Core's
// default model binding for `List<int> ids` expects repeated "ids=1&ids=2", not "ids[]=1&ids[]=2".
export async function printInvoicesBulkPdf(ids: number[]) {
  const query = ids.map((id) => `ids=${id}`).join("&");
  const { data } = await apiClient.get(`/invoices/print/pdf?${query}`, { responseType: "blob" });
  return data as Blob;
}

// Full item-level detail for a set of invoices (same repeated-key query-string reasoning as
// printInvoicesBulkPdf above) — used to build the per-trader WhatsApp statement text with the
// same content as the printed PDF.
export async function getInvoicesBatch(ids: number[]) {
  if (ids.length === 0) return [] as InvoiceDto[];
  const query = ids.map((id) => `ids=${id}`).join("&");
  const { data } = await apiClient.get<InvoiceDto[]>(`/invoices/batch?${query}`);
  return data;
}

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
