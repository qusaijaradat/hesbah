import { apiClient } from "./client";
import type { CreateGoodsEntryRequest, FarmerGoodsStockDto, GoodsEntryDto, GoodsStockRow, UpdateGoodsEntryRequest } from "../types";

export async function getFarmerGoodsStock(farmerId: number) {
  const { data } = await apiClient.get<FarmerGoodsStockDto>(`/goods/farmer/${farmerId}`);
  return data;
}

/** "البضاعة المتوفرة حاليًا" summed across ALL farmers — used at the bottom of "بضاعة الباعة"
 * itself. See getGoodsGlobalStockForReports below for the same data reached from "الإغلاق اليومي". */
export async function getGoodsGlobalStock() {
  const { data } = await apiClient.get<GoodsStockRow[]>("/goods/stock");
  return data;
}

export async function createGoodsEntry(request: CreateGoodsEntryRequest) {
  const { data } = await apiClient.post<GoodsEntryDto>("/goods", request);
  return data;
}

export async function updateGoodsEntry(id: number, request: UpdateGoodsEntryRequest) {
  const { data } = await apiClient.put<GoodsEntryDto>(`/goods/${id}`, request);
  return data;
}

export async function deleteGoodsEntry(id: number) {
  await apiClient.delete(`/goods/${id}`);
}
