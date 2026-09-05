import { apiErrorMessage } from "../api/client";

export interface BulkDeleteOutcome {
  deletedCount: number;
  failedCount: number;
  /** One line per failure: "<label> — <reason>", ready to join with "\n" for a single summary
   * message instead of one alert per failed row. */
  failures: string[];
}

/**
 * Runs `deleteFn` once per selected row, SEQUENTIALLY (never Promise.all) — explicit request:
 * "احذف اللي ممكن وقرّرلي الباقي" (delete what's deletable, report the rest). Some rows are
 * protected by a server-side business rule (e.g. a partner/employee/role with prior history) and
 * will legitimately fail; this never throws on a single failure, it just records it and keeps
 * going, so one blocked row never stops the whole batch. Sequential (not parallel) so failures
 * come back in the same order the rows were selected, and so a partner's own two invoices-in-a-row
 * delete calls can't race each other server-side.
 */
export async function runBulkDelete<T>(
  items: T[],
  getId: (item: T) => number,
  getLabel: (item: T) => string,
  deleteFn: (id: number) => Promise<void>,
): Promise<BulkDeleteOutcome> {
  let deletedCount = 0;
  const failures: string[] = [];
  for (const item of items) {
    try {
      await deleteFn(getId(item));
      deletedCount++;
    } catch (err) {
      failures.push(`${getLabel(item)} — ${apiErrorMessage(err, "فشل الحذف")}`);
    }
  }
  return { deletedCount, failedCount: failures.length, failures };
}

/** One consistent Arabic summary — meant to drop straight into whatever error/message area the
 * page already shows for its own single-row delete (no separate modal/toast introduced). */
export function summarizeBulkDelete(outcome: BulkDeleteOutcome): string {
  if (outcome.failedCount === 0) return `تم حذف ${outcome.deletedCount} عنصر بنجاح.`;
  if (outcome.deletedCount === 0) return `تعذر حذف العناصر المحددة:\n${outcome.failures.join("\n")}`;
  return `تم حذف ${outcome.deletedCount} عنصر — وتعذر حذف ${outcome.failedCount}:\n${outcome.failures.join("\n")}`;
}
