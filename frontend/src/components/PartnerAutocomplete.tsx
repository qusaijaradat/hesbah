import { useEffect, useMemo, useRef, useState } from "react";
import { suggestPartners } from "../api/partners";
import { useSuggestionKeyboard } from "../lib/useSuggestionKeyboard";
import type { PartnerSuggestionDto, PartnerType } from "../types";

/**
 * Requirement doc §3: "while typing a name, suggestions of existing names appear,
 * to speed up daily entry and prevent duplicates."
 *
 * By default this requires picking an existing partner from the suggestion list
 * (used for payments — you can't pay someone who doesn't already have an account).
 * Pass `allowNew` where a brand new name should be accepted as-is (e.g. invoices,
 * where a different trader/farmer shows up most days) — the typed text is reported
 * via `onFreeTextChange` so the caller can send it to the backend, which will look up
 * a matching existing partner by name or create a new one automatically.
 *
 * With `allowNew`, a name that matches nothing gets its own row at the bottom of the list
 * ("➕ إضافة ... كـ..."). That row does not change what happens — the typed text was already
 * going to be accepted — it just says so on screen. Without it the dropdown answered a new name
 * with nothing but "لا يوجد نتائج مطابقة", which reads as a dead end: staff would leave the
 * invoice, go add the person on the partners page, and come back, for a step the form never
 * needed.
 */
export function PartnerAutocomplete({
  label, value, onChange, placeholder, allowNew, onFreeTextChange, types, newTypeLabel, onCreateNew, text,
}: {
  label: string;
  value: { id: number; name: string } | null;
  onChange: (partner: { id: number; name: string } | null) => void;
  placeholder?: string;
  allowNew?: boolean;
  onFreeTextChange?: (text: string) => void;
  /** Restrict suggestions to these partner types (e.g. ["Farmer", "Driver", "Both"]) — omit for no restriction. */
  types?: PartnerType[];
  /** What this field's side is called, for the "add new" row: "مشتري", "بائع", "سائق". */
  newTypeLabel?: string;
  /**
   * Creates the partner immediately and returns them, for a field that cannot defer it — the
   * "بضاعة الباعة" picker loads a specific seller's stock, so it needs a real id in hand, not a
   * name to be resolved later on save. Callers pass this only when the signed-in user may actually
   * create a partner; the invoice and payment forms leave it out and let the save resolve the name.
   */
  onCreateNew?: (name: string) => Promise<{ id: number; name: string }>;
  /**
   * The text in the box, when the caller keeps it (the same state it receives through
   * onFreeTextChange). Pass it and this field is fully controlled — what is on screen is exactly
   * what the form will submit, and the caller can clear it by clearing that state.
   *
   * Without it the field keeps its own copy, which could drift from the caller's in both
   * directions: typing over an already-picked name blanked the box while the form kept the
   * half-typed text (so the invoice saved a name that was nowhere on screen), and resetting a form
   * whose field held an unpicked name left that name sitting in the box over empty form state.
   */
  text?: string;
}) {
  const controlled = text !== undefined;
  const [internalQuery, setInternalQuery] = useState(value?.name ?? "");
  const query = controlled ? text : internalQuery;

  /** The one way the text changes: the caller hears about it, and an uncontrolled field records it. */
  function commitText(next: string) {
    if (!controlled) setInternalQuery(next);
    onFreeTextChange?.(next);
  }

  const [suggestions, setSuggestions] = useState<PartnerSuggestionDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  // Debouncing only cancels a PENDING timer, not a request already in flight — fast typing (or
  // refocusing) can still have two suggestPartners calls in flight at once, and a slower earlier
  // one can resolve AFTER a faster later one and overwrite it with stale results. This counter
  // tags each fetch so only the most recently STARTED one is ever applied to the dropdown,
  // matching the same "cancelled" guard InvoiceEditPage already uses for its own account lookup.
  const requestSeqRef = useRef(0);

  // Uncontrolled only: mirror a selection the caller made from outside (loading a record to edit,
  // resetting a form). Skipped for the caller's echo of this field's OWN onChange(null) — that
  // fires on every keystroke over a picked name, and syncing to it would wipe the keystroke.
  const selfClearedRef = useRef(false);
  useEffect(() => {
    if (controlled) return;
    if (selfClearedRef.current) { selfClearedRef.current = false; return; }
    setInternalQuery(value?.name ?? "");
  }, [value?.id, controlled]);

  function fetchSuggestions(text: string) {
    // Opens immediately so the field visibly reads as a picker (dropdown appears the
    // instant it's focused) rather than a plain text box — even before the debounced
    // results below come back, or when there happen to be no matches at all.
    setOpen(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const seq = ++requestSeqRef.current;
      const results = await suggestPartners(text, types);
      if (seq !== requestSeqRef.current) return; // a newer request has since started — drop this stale result
      setSuggestions(results);
      setLoaded(true);
    }, 200);
  }

  function handleInput(next: string) {
    if (value) selfClearedRef.current = true;
    commitText(next);
    onChange(null);
    setCreateError(null);
    fetchSuggestions(next);
  }

  const trimmed = query.trim();
  // One list drives both the rendered rows and the arrow-key highlight, so the mouse and the
  // keyboard can never disagree about which row is which. Memoised because useSuggestionKeyboard
  // drops its highlight whenever this array's identity changes — rebuilding it every render would
  // clear the highlight the moment an arrow key set it.
  const options: Option[] = useMemo(() => {
    const rows: Option[] = suggestions.map((partner) => ({ kind: "existing", partner }));
    const alreadyListed = suggestions.some((s) => s.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (allowNew && trimmed !== "" && !alreadyListed) rows.push({ kind: "new", name: trimmed });
    return rows;
  }, [suggestions, allowNew, trimmed]);

  /** Shared by the mouse (clicking a row) and the keyboard (Enter on the highlighted row). */
  async function pickOption(option: Option) {
    if (option.kind === "existing") {
      onChange({ id: option.partner.id, name: option.partner.name });
      commitText(option.partner.name);
      setOpen(false);
      return;
    }

    // A new name. Without onCreateNew there is nothing to do but keep the text: the form's own
    // save resolves it (find-or-create) — picking the row is just the reader confirming it.
    if (!onCreateNew) {
      commitText(option.name);
      setOpen(false);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreateNew(option.name);
      onChange(created);
      commitText(created.name);
      setOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "فشلت الإضافة");
    } finally {
      setCreating(false);
    }
  }

  const keyboard = useSuggestionKeyboard({
    open,
    items: options,
    onOpen: () => fetchSuggestions(query),
    onClose: () => setOpen(false),
    onPick: pickOption,
  });

  return (
    <div className="relative">
      <label className="label">{label}</label>
      <input
        className="input pe-6"
        value={query}
        placeholder={placeholder}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => fetchSuggestions(query)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={keyboard.handleKeyDown}
      />
      {/* Small dropdown marker so the field visibly reads as a picker, not plain text. */}
      <span className="pointer-events-none absolute inset-y-0 end-2 top-6 flex items-center text-gray-400 text-xs">▾</span>
      {open && (
        <ul role="listbox" className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {options.map((option, index) => (
            <li
              key={option.kind === "existing" ? `p${option.partner.id}` : "new"}
              role="option"
              aria-selected={index === keyboard.activeIndex}
              // Only the arrow-key highlight needs a ref — it's the one the list scrolls to.
              ref={index === keyboard.activeIndex ? keyboard.activeItemRef : undefined}
              className={`cursor-pointer px-3 py-2 text-sm hover:bg-brand-50 ${index === keyboard.activeIndex ? "bg-brand-50" : ""} ${
                option.kind === "new" ? "border-t border-gray-100 text-brand-700 font-medium" : ""
              }`}
              // Keeps the mouse and the keyboard pointing at the same row, so moving the mouse
              // over the list and then pressing Enter takes what's actually highlighted.
              onMouseEnter={() => keyboard.setActiveIndex(index)}
              // Without this, the input's onBlur (fired by the mousedown itself, before
              // the click) can close the dropdown a beat before onClick runs, so the pick
              // never lands — preventDefault here keeps focus on the input the whole time.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickOption(option)}
            >
              {option.kind === "existing" ? (
                <>
                  {option.partner.name}{" "}
                  {option.partner.type && <span className="text-xs text-gray-400">({typeLabel(option.partner.type)})</span>}
                </>
              ) : (
                <>
                  ➕ إضافة «{option.name}»
                  {newTypeLabel && <span className="text-xs text-gray-500"> كـ{newTypeLabel} جديد</span>}
                  {creating && <span className="text-xs text-gray-400"> — جاري الإضافة...</span>}
                </>
              )}
            </li>
          ))}
          {options.length === 0 && (
            <li className="px-3 py-2 text-xs text-gray-400">
              {loaded ? "لا يوجد نتائج مطابقة" : "جاري التحميل..."}
            </li>
          )}
        </ul>
      )}
      {createError && <div className="text-xs text-red-600 mt-1">{createError}</div>}
      {value === null && trimmed !== "" && !open && (
        allowNew ? (
          <div className="text-xs text-gray-500 mt-1">اسم جديد — سيُضاف تلقائيًا عند الحفظ.</div>
        ) : (
          <div className="text-xs text-amber-600 mt-1">لم يتم اختيار شخص من القائمة — سيتم اعتباره غير صالح عند الحفظ.</div>
        )
      )}
    </div>
  );
}

/** A row in the dropdown: someone who already exists, or the name typed so far. */
type Option =
  | { kind: "existing"; partner: PartnerSuggestionDto }
  | { kind: "new"; name: string };

function typeLabel(type: string) {
  if (type === "Farmer") return "بائع";
  if (type === "Driver") return "سائق";
  if (type === "Merchant") return "مشتري";
  return "بائع/مشتري";
}
