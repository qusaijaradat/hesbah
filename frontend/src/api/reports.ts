import { apiClient } from "./client";
import type { FarmerReportRow, MerchantReportRow, DriverReportRow, MerchantItemBreakdownRow, FarmerItemBreakdownRow, DriverItemBreakdownRow, MarketReportRow, AgingReportRow, DailyClosingDto, GoodsStockRow } from "../types";

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

export async function driverReport(filter: ReportFilter) {
  const { data } = await apiClient.get<DriverReportRow[]>("/reports/drivers", { params: filter });
  return data;
}

/** Dashboard "كشف المشترين حسب الفترة" — per-item breakdown (اسم/صنف/كمية/سعر) under each merchant. */
export async function merchantItemsBreakdown(filter: ReportFilter) {
  const { data } = await apiClient.get<MerchantItemBreakdownRow[]>("/reports/merchants/items-breakdown", { params: filter });
  return data;
}

/** Dashboard "كشف المشترين حسب الفترة" print button — same item-level breakdown as the on-screen
 * list, see ExportService.GenerateBuyerStatementPdf. */
export async function printBuyerStatementPdf(filter: ReportFilter) {
  const { data } = await apiClient.get("/reports/merchants/print/pdf", { params: filter, responseType: "blob" });
  return data as Blob;
}

/** "طباعة الفواتير" → قسم البائع's "كشف بائع حسب الفترة" — farmer counterpart to
 * merchantItemsBreakdown above. */
export async function farmerItemsBreakdown(filter: ReportFilter) {
  const { data } = await apiClient.get<FarmerItemBreakdownRow[]>("/reports/farmers/items-breakdown", { params: filter });
  return data;
}

export async function printFarmerItemsStatementPdf(filter: ReportFilter) {
  const { data } = await apiClient.get("/reports/farmers/items-breakdown/print/pdf", { params: filter, responseType: "blob" });
  return data as Blob;
}

/** "طباعة الفواتير" → قسم السائق's "كشف سائق حسب الفترة" — driver counterpart to
 * merchantItemsBreakdown above. */
export async function driverItemsBreakdown(filter: ReportFilter) {
  const { data } = await apiClient.get<DriverItemBreakdownRow[]>("/reports/drivers/items-breakdown", { params: filter });
  return data;
}

export async function printDriverItemsStatementPdf(filter: ReportFilter) {
  const { data } = await apiClient.get("/reports/drivers/items-breakdown/print/pdf", { params: filter, responseType: "blob" });
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

export type ReportKind = "farmers" | "merchants" | "drivers" | "market" | "aging";

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

/** "البضاعة المتوفرة حاليًا" summed across ALL farmers — same data as api/goods.ts's
 * getGoodsGlobalStock, reached through reports.view instead of farmerGoods.view so it's visible on
 * "الإغلاق اليومي" for a user who can't necessarily open "بضاعة الباعة" itself. Deliberately not
 * scoped to whichever date the Daily Closing page has selected — always the live running total. */
export async function getGoodsGlobalStockForReports() {
  const { data } = await apiClient.get<GoodsStockRow[]>("/reports/goods/stock");
  return data;
}
