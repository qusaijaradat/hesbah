import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { focusNextField } from "./formNavigation";

/**
 * Arrow-key + Enter driving for the two suggestion dropdowns (PartnerAutocomplete,
 * ItemAutocomplete). Both fields are styled to read as pickers — they even carry a ▾ marker — but
 * were mouse-only, so on a form otherwise fully keyboard-driven (see lib/formNavigation.ts) they
 * were the one place a hand had to leave the keyboard. Behavior matches a native <select> as
 * closely as a text field can:
 *
 *   ↓ / ↑   open the list, then move the highlight (wrapping at both ends)
 *   Enter   take the highlighted suggestion AND move on to the next field, in one keystroke —
 *           or, with nothing highlighted, just close the list and let the global Enter handler
 *           advance, keeping whatever free text was typed (a new farmer/item name)
 *   Esc     close the list, leaving the typed text alone
 */
export function useSuggestionKeyboard<T>({ open, items, onOpen, onClose, onPick }: {
  open: boolean;
  items: readonly T[];
  /** Re-runs the same fetch the field's own onFocus does, for ↓ on a closed list. */
  onOpen: () => void;
  onClose: () => void;
  onPick: (item: T) => void;
}) {
  /** -1 = nothing highlighted, which is the state a freshly opened list starts in: the first ↓
   * moves to the first suggestion rather than the second. */
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeItemRef = useRef<HTMLLIElement | null>(null);

  // A new result set (or a list that just closed) invalidates the old highlight — index 3 of the
  // previous suggestions is a different name now, and taking it on Enter would be a silent
  // mis-pick.
  useEffect(() => setActiveIndex(-1), [items, open]);

  // Keeps the highlight visible while arrowing through a list longer than the 56-unit-tall panel.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Always — otherwise the caret jumps to the start/end of the typed text instead.
      event.preventDefault();
      if (!open) {
        onOpen();
        return;
      }
      if (items.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((previous) => {
        // From the "nothing highlighted" -1 start, ↓ lands on the first suggestion and ↑ on the
        // last; from either end it wraps around, same as a native <select>.
        const next = previous + step;
        if (next < 0) return items.length - 1;
        if (next >= items.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "Enter") {
      const highlighted = activeIndex >= 0 ? items[activeIndex] : undefined;
      if (highlighted === undefined) {
        // Free text stands as typed. Deliberately NOT preventDefault'd, so the app-wide Enter
        // handler still moves to the next field — one Enter either way.
        onClose();
        return;
      }
      event.preventDefault();
      onPick(highlighted);
      onClose();
      focusNextField(event.currentTarget);
    }
  }

  return { activeIndex, setActiveIndex, activeItemRef, handleKeyDown };
}
