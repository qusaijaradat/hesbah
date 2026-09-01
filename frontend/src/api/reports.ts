import { apiClient } from "./client";
import type { FarmerReportRow, MerchantReportRow, MarketReportRow, AgingReportRow, DailyClosingDto } from "../types";

export interface ReportFilter {
  dateFrom?: string;
  dateTo?: string;
  partnerId?: number;
  grouping?: "daily" | "monthly";
}

export async function farmerReport(filter: ReportFilter) {
  const { data } = await apiClient.get<FarmerReportRow[]>("/reports/farmers", { params: filter });
  return data;
}

export async function merchantReport(filter: ReportFilter) {
  const { data } = await apiClient.get<MerchantReportRow[]>("/reports/merchants", { params: filter });
  return data;
}

/** Dashboard "كشف المشترين حسب الفترة" print button — اسم المشتري + المبلغ only, see
 * ExportService.GenerateBuyerStatementPdf. */
export async function printBuyerStatementPdf(filter: ReportFilter) {
  const { data } = await apiClient.get("/reports/merchants/print/pdf", { params: filter, responseType: "blob" });
  return data as Blob;
}

export async function marketReport(filter: ReportFilter) {
  const { data } = await apiClient.get<MarketReportRow[]>("/reports/market", { params: filter });
  return data;
}

export async function agingReport(filter: ReportFilter) {
  const { data } = await apiClient.get<AgingReportRow[]>("/reports/aging", { params: filter });
  return data;
}

export type ReportKind = "farmers" | "merchants" | "market" | "aging";

export async function exportReport(kind: ReportKind, format: "excel" | "pdf", filter: ReportFilter) {
  const { data } = await apiClient.get(`/reports/${kind}/export/${format}`, { params: filter, responseType: "blob" });
  return data as Blob;
}

export async function dailyClosingReport(date: string) {
  const { data } = await apiClient.get<DailyClosingDto>("/reports/daily-closing", { params: { date } });
  return data;
}

export async function exportDailyClosingPdf(date: string) {
  const { data } = await apiClient.get("/reports/daily-closing/export/pdf", { params: { date }, responseType: "blob" });
  return data as Blob;
}
