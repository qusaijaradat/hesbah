import { useRef, useState } from "react";
import { suggestItems } from "../api/items";
import type { ItemDto } from "../types";

/**
 * The item-name field on an invoice line: acts like a real <select> of everything sold
 * before — click it and the whole list drops down immediately (even before typing
 * anything), same as the trader/farmer pickers — but still accepts any freshly typed
 * name. A name that doesn't match anything gets added to the catalog automatically when
 * the invoice is saved (see ItemService.FindOrCreateAsync), and from then on it shows up
 * here too. The dropdown panel opens on focus regardless of whether there are any results
 * yet, with a small ▾ marker on the field, so it visibly reads as a picker rather than a
 * plain text box even the very first time (before any items have been added).
 */
export function ItemAutocomplete({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<ItemDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<number | null>(null);

  function fetchSuggestions(text: string) {
    setOpen(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const results = await suggestItems(text);
      setSuggestions(results);
      setLoaded(true);
    }, 150);
  }

  return (
    <div className="relative">
      <input
        className="input pe-6"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          fetchSuggestions(e.target.value);
        }}
        onFocus={() => fetchSuggestions(value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {/* Small dropdown marker so the field visibly reads as a picker, not plain text. */}
      <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-gray-400 text-xs">▾</span>
      {open && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {suggestions.length > 0 ? (
            suggestions.map((s) => (
              <li
                key={s.id}
                className="cursor-pointer px-3 py-2 text-sm hover:bg-brand-50"
                // Without this, the input's onBlur (fired by the mousedown itself, before
                // the click) can close the dropdown a beat before onClick runs, so the pick
                // never lands — preventDefault here keeps focus on the input the whole time.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.name);
                  setOpen(false);
                }}
              >
                {s.name}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-xs text-gray-400">
              {loaded ? "لا يوجد أصناف مطابقة — تابع الكتابة لإضافة صنف جديد" : "جاري التحميل..."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
