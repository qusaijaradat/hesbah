import { apiErrorMessage } from "../api/client";

export interface BulkEditOutcome {
  updatedCount: number;
  failedCount: number;
  /** One line per failure: "<label> — <reason>", ready to join into a single summary message. */
  failures: string[];
}

/**
 * Applies one change to many rows, SEQUENTIALLY — the same shape and the same reasoning as
 * runBulkDelete: some rows will legitimately be refused by a server-side rule, and one refusal
 * must not abandon the other thirty. Every row is attempted, the refusals are collected, and the
 * caller gets one summary instead of thirty alerts.
 *
 * Sequential rather than Promise.all for a second reason here: two updates to rows that share a
 * parent (two invoices of one partner, say) would otherwise race each other server-side, and a
 * bulk edit is precisely the operation that selects rows sharing a parent.
 */
export async function runBulkEdit<T>(
  items: T[],
  getLabel: (item: T) => string,
  applyFn: (item: T) => Promise<void>,
): Promise<BulkEditOutcome> {
  let updatedCount = 0;
  const failures: string[] = [];
  for (const item of items) {
    try {
      await applyFn(item);
      updatedCount++;
    } catch (err) {
      failures.push(`${getLabel(item)} — ${apiErrorMessage(err, "فشل التعديل")}`);
    }
  }
  return { updatedCount, failedCount: failures.length, failures };
}

/** One consistent Arabic summary, for the page's existing error area — no new toast or modal. */
export function summarizeBulkEdit(outcome: BulkEditOutcome): string {
  const head = outcome.updatedCount > 0
    ? `تم تعديل ${outcome.updatedCount}، وتعذّر تعديل ${outcome.failedCount}:`
    : `تعذّر تعديل ${outcome.failedCount}:`;
  return [head, ...outcome.failures].join("\n");
}
