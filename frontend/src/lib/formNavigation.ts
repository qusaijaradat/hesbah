import { useEffect } from "react";

/**
 * Keyboard-first data entry: pressing Enter in a field moves to the NEXT field, exactly the way
 * Tab does — a full day of invoices gets typed by hand here, and reaching for the mouse (or Tab,
 * which people habitually don't) between every box is what slows that down. Enter also stops
 * being able to silently submit a half-filled form as a side effect.
 *
 * Installed ONCE at the app root (see useEnterAdvancesFocus below) as a single document-level
 * listener, deliberately NOT as an onKeyDown on every input: every page — including any page
 * added later — gets the behavior with no per-field wiring anyone can forget.
 */

/** Everything Enter can land ON. <select> is included so arrow keys still pick its value the
 * native way while Enter just moves along; <textarea> is a valid destination even though it is
 * never a source (see the tag check in the handler — Enter inside one is a newline). */
const FIELD_SELECTOR = "input, select, textarea";

/** Input types whose Enter already means something else (activate the button, open the file
 * picker) or that are never focusable at all. */
const NON_ADVANCING_INPUT_TYPES = new Set(["submit", "reset", "button", "image", "file", "hidden"]);

/**
 * How far forward Enter is allowed to walk. A real <form> (login, change password) is the obvious
 * boundary; `.fixed.inset-0` is this app's modal overlay wrapper, which keeps Enter inside an open
 * dialog instead of jumping into the table still rendered behind it. `[data-field-scope]` is the
 * explicit opt-in for anything that is neither. Pages that split ONE logical form across several
 * `.card`s on purpose (the new-invoice screen: header fields, then the items table, then totals)
 * deliberately have no boundary between them — Enter should carry straight from the last header
 * field into the first item row.
 */
const SCOPE_SELECTOR = "form, [data-field-scope], .fixed.inset-0";

function isEligibleField(element: Element): element is HTMLElement {
  const field = element as HTMLInputElement;
  if (field.disabled) return false;
  if (field.tagName === "INPUT" && NON_ADVANCING_INPUT_TYPES.has(field.type)) return false;
  // Escape hatch for a field that needs its own Enter (or shouldn't be walked into at all).
  if (field.getAttribute("data-enter-advance") === "off") return false;
  if (field.tabIndex < 0) return false;
  // offsetParent is null for anything display:none'd (a collapsed section, a closed modal still
  // mounted); getClientRects covers position:fixed elements, whose offsetParent is null even when
  // they are perfectly visible.
  return field.offsetParent !== null || field.getClientRects().length > 0;
}

/**
 * Moves focus to the field after `from` in document order, which for every form here matches
 * reading order (including across the cells of an invoice item row, then on to the next row).
 * Returns false when `from` is the last field in its scope — callers use that to leave the
 * keystroke alone rather than swallowing it.
 */
export function focusNextField(from: HTMLElement): boolean {
  const scope = from.closest(SCOPE_SELECTOR) ?? document.body;
  const fields = Array.from(scope.querySelectorAll(FIELD_SELECTOR)).filter(isEligibleField);
  const currentIndex = fields.indexOf(from);
  if (currentIndex === -1) return false;

  const next = fields[currentIndex + 1];
  if (!next) return false;

  next.focus();
  // Pre-select what's already there so typing replaces it instead of appending — the same thing
  // tabbing through a form of pre-filled defaults does. Input types that don't support text
  // selection (date, number in some browsers) either no-op or throw; neither matters here.
  if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
    try { next.select(); } catch { /* type doesn't support selection — focus alone is enough */ }
  }
  return true;
}

/**
 * The document-level listener itself, exported separately from the hook below purely so it can be
 * exercised on its own.
 */
export function advanceFocusOnEnter(event: KeyboardEvent) {
  if (event.key !== "Enter") return;
  // Something closer to the field already claimed this Enter — a suggestion dropdown taking the
  // highlighted row, ItemsPage's inline save. Never advance on top of it.
  if (event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  // Mid-composition Enter commits the IME candidate; it is not a "next field" request.
  if (event.isComposing) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;
  // A textarea's Enter is a newline, and a button's/link's activates it — only single-line fields
  // and <select>s hand their Enter over to us.
  if (target.tagName !== "INPUT" && target.tagName !== "SELECT") return;
  if (!isEligibleField(target)) return;

  // Nothing after it: leave Enter completely alone, so the last field of a real <form> (login,
  // change password) still submits it exactly as before.
  if (focusNextField(target)) event.preventDefault();
}

/** Call once, at the app root. */
export function useEnterAdvancesFocus() {
  useEffect(() => {
    document.addEventListener("keydown", advanceFocusOnEnter);
    return () => document.removeEventListener("keydown", advanceFocusOnEnter);
  }, []);
}
