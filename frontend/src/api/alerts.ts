import { apiClient } from "./client";
import type { AlertDto } from "../types";

/** The top-of-page alerts, already filtered to what this user is allowed to see — the endpoint
 * gates each kind on the caller's own permissions and returns an empty list rather than a 403
 * when they can see none of it (see backend AlertsController). */
export async function listAlerts() {
  const { data } = await apiClient.get<AlertDto[]>("/alerts");
  return data;
}
