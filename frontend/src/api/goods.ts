import { apiClient } from "./client";
import type { CreateGoodsEntryRequest, FarmerGoodsStockDto, GoodsEntryDto, UpdateGoodsEntryRequest } from "../types";

export async function getFarmerGoodsStock(farmerId: number) {
  const { data } = await apiClient.get<FarmerGoodsStockDto>(`/goods/farmer/${farmerId}`);
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
