import { apiClient } from "./client";

export interface SearchHitDto {
  /** "Partner" | "Invoice" | "Item" — what the row points at; only used to pick an icon. */
  kind: string;
  id: number;
  title: string;
  subtitle: string;
  /**
   * Where tapping it goes, decided server-side. Not derivable here: a person who is both a buyer
   * and a seller has two accounts and comes back as two rows, each already pointing at its own.
   */
  url: string;
}

/**
 * Finds partners, invoices and items in one call. Already filtered to what this user may see —
 * the server gates each kind on their own permissions, so there is nothing to check here.
 */
export async function globalSearch(q: string) {
  const { data } = await apiClient.get<SearchHitDto[]>("/search", { params: { q } });
  return data;
}
