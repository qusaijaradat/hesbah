import { useEffect, useRef, useState } from "react";
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
 */
export function PartnerAutocomplete({
  label, value, onChange, placeholder, allowNew, onFreeTextChange, types,
}: {
  label: string;
  value: { id: number; name: string } | null;
  onChange: (partner: { id: number; name: string } | null) => void;
  placeholder?: string;
  allowNew?: boolean;
  onFreeTextChange?: (text: string) => void;
  /** Restrict suggestions to these partner types (e.g. ["Farmer", "Driver", "Both"]) — omit for no restriction. */
  types?: PartnerType[];
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [suggestions, setSuggestions] = useState<PartnerSuggestionDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<number | null>(null);
  // Debouncing only cancels a PENDING timer, not a request already in flight — fast typing (or
  // refocusing) can still have two suggestPartners calls in flight at once, and a slower earlier
  // one can resolve AFTER a faster later one and overwrite it with stale results. This counter
  // tags each fetch so only the most recently STARTED one is ever applied to the dropdown,
  // matching the same "cancelled" guard InvoiceEditPage already uses for its own account lookup.
  const requestSeqRef = useRef(0);

  useEffect(() => setQuery(value?.name ?? ""), [value?.id]);

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

  function handleInput(text: string) {
    setQuery(text);
    onChange(null);
    onFreeTextChange?.(text);
    fetchSuggestions(text);
  }

  /** Shared by the mouse (clicking a row) and the keyboard (Enter on the highlighted row). */
  function pickSuggestion(suggestion: PartnerSuggestionDto) {
    onChange({ id: suggestion.id, name: suggestion.name });
    onFreeTextChange?.(suggestion.name);
    setQuery(suggestion.name);
    setOpen(false);
  }

  const keyboard = useSuggestionKeyboard({
    open,
    items: suggestions,
    onOpen: () => fetchSuggestions(query),
    onClose: () => setOpen(false),
    onPick: pickSuggestion,
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
          {suggestions.length > 0 ? (
            suggestions.map((s, index) => (
              <li
                key={s.id}
                role="option"
                aria-selected={index === keyboard.activeIndex}
                // Only the arrow-key highlight needs a ref — it's the one the list scrolls to.
                ref={index === keyboard.activeIndex ? keyboard.activeItemRef : undefined}
                className={`cursor-pointer px-3 py-2 text-sm hover:bg-brand-50 ${index === keyboard.activeIndex ? "bg-brand-50" : ""}`}
                // Keeps the mouse and the keyboard pointing at the same row, so moving the mouse
                // over the list and then pressing Enter takes what's actually highlighted.
                onMouseEnter={() => keyboard.setActiveIndex(index)}
                // Without this, the input's onBlur (fired by the mousedown itself, before
                // the click) can close the dropdown a beat before onClick runs, so the pick
                // never lands — preventDefault here keeps focus on the input the whole time.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSuggestion(s)}
              >
                {s.name} {s.type && <span className="text-xs text-gray-400">({typeLabel(s.type)})</span>}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-xs text-gray-400">
              {loaded ? "لا يوجد نتائج مطابقة" : "جاري التحميل..."}
            </li>
          )}
        </ul>
      )}
      {value === null && query.trim() !== "" && !open && (
        allowNew ? (
          <div className="text-xs text-gray-500 mt-1">اسم جديد — سيُضاف تلقائيًا عند حفظ الفاتورة.</div>
        ) : (
          <div className="text-xs text-amber-600 mt-1">لم يتم اختيار شخص من القائمة — سيتم اعتباره غير صالح عند الحفظ.</div>
        )
      )}
    </div>
  );
}

function typeLabel(type: string) {
  if (type === "Farmer") return "بائع";
  if (type === "Driver") return "سائق";
  if (type === "Merchant") return "مشتري";
  return "بائع/مشتري";
}
