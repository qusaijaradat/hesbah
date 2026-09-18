import { apiClient } from "./client";
import type { PageReadResult } from "../types";

/**
 * Reads a photographed ledger page into rows.
 *
 * The photo is sent to the server, which asks Claude to read it — see the backend's PageReader for
 * what it promises and what it refuses to do. Nothing is saved: the rows land in the form on screen
 * for the market to read and correct before anything is submitted.
 */
export async function readPage(image: File) {
  const body = new FormData();
  body.append("image", image);
  const { data } = await apiClient.post<PageReadResult>("/page-read", body);
  return data;
}

/** Whether a key is configured at all — the button is hidden when it is not. */
export async function pageReadStatus() {
  const { data } = await apiClient.get<{ configured: boolean }>("/page-read/status");
  return data.configured;
}
