import { apiClient } from "./client";
import type { AuditLogDto, PagedResult } from "../types";

export interface AuditLogFilter {
  entityName?: string;
  action?: string;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listAuditLogs(filter: AuditLogFilter) {
  const { data } = await apiClient.get<PagedResult<AuditLogDto>>("/audit-logs", { params: filter });
  return data;
}

export async function listAuditLogEntityNames() {
  const { data } = await apiClient.get<string[]>("/audit-logs/entity-names");
  return data;
}
