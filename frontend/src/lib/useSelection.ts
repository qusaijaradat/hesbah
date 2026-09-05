import { useState } from "react";

/**
 * Reusable "تحديد الكل / تحديد واحد" checkbox state for any table of rows with numeric ids —
 * generalizes the Set<number> pattern BulkPrintPage's own toggleOne/toggleAll originally used for
 * print selection, now reused everywhere a table offers bulk delete (explicit request: "select
 * all" on every table that supports delete, so a full page of rows can be removed in one go).
 *
 * toggleAll always reflects the CURRENTLY LOADED/FILTERED rows passed in, never some separately
 * stored list — so it stays correct after a search/filter narrows what's on screen, and a header
 * checkbox bound to `ids.length > 0 && ids.every(id => selected.has(id))` reports the right
 * checked/unchecked state even when rows were selected before the filter changed.
 */
export function useSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Selects every id in `ids` — unless every one of them is already selected, in which case it
   * clears the selection instead (the standard "header checkbox" toggle behavior). */
  function toggleAll(ids: number[]) {
    setSelected((prev) => (ids.length > 0 && ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)));
  }

  function clear() {
    setSelected(new Set());
  }

  return { selected, setSelected, toggleOne, toggleAll, clear };
}
