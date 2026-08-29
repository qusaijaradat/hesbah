import { apiClient } from "./client";
import type { ItemDto, PagedResult } from "../types";

// A blank query returns a full pick-list from the backend (same convention as
// suggestPartners) so the field can show "everything we've seen before" on focus.
export async function suggestItems(query: string) {
  const { data } = await apiClient.get<ItemDto[]>("/items/suggest", { params: { q: query || undefined } });
  return data;
}

export async function listItems(params: { search?: string; page?: number; pageSize?: number }) {
  const { data } = await apiClient.get<PagedResult<ItemDto>>("/items", { params });
  return data;
}

export async function createItem(name: string) {
  const { data } = await apiClient.post<ItemDto>("/items", { name });
  return data;
}

export async function updateItem(id: number, name: string) {
  const { data } = await apiClient.put<ItemDto>(`/items/${id}`, { name });
  return data;
}

export async function deleteItem(id: number) {
  await apiClient.delete(`/items/${id}`);
}
