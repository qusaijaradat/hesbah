import { apiClient } from "./client";
import type { PeriodLockStatusDto } from "../types";

/**
 * Closing a settled month against further writing, and opening one back up.
 *
 * Reading the status needs no permission: anybody entering an invoice benefits from knowing where
 * the line is, and being refused with no way to see why is how people decide the system is broken.
 */
export async function getPeriodLock() {
  const { data } = await apiClient.get("/period-lock");
  return data as PeriodLockStatusDto;
}

/** Closes one month, named as "2026-08". The server refuses a month that has not finished. */
export async function closePeriod(month: string) {
  const { data } = await apiClient.post("/period-lock/close", { month });
  return data as PeriodLockStatusDto;
}

/** Steps the lock back one month. Takes no argument on purpose — reopening is for the month just
 * settled, and choosing a month would make it a way to open the whole history. */
export async function reopenPeriod() {
  const { data } = await apiClient.post("/period-lock/reopen");
  return data as PeriodLockStatusDto;
}
