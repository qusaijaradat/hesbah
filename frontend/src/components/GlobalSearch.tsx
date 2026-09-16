import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { globalSearch, type SearchHitDto } from "../api/search";

/**
 * The one box that finds anything, in the app bar.
 *
 * Twenty screens, and until now reaching a record meant knowing which screen held it: "فاتورة ٤٥٦"
 * meant remembering that invoices are filtered by number on the invoices page, and "أبو علي" meant
 * deciding whether he is a buyer or a seller before picking a page. That is a tax paid every day,
 * and most heavily by whoever knows the app least.
 *
 * It finds the record and goes there. It is not a report, and the server decides both what may be
 * shown (each kind gated on the searcher's own permissions) and where each row leads.
 *
 * Typing is debounced, and an answer that arrives after a newer one was asked for is DROPPED — the
 * classic way one of these ends up showing results for "أبو" under the word "أبو علي", which reads
 * as a search box that is simply wrong.
 */

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

const KIND_ICON: Record<string, string> = {
  Partner: "👤",
  Invoice: "🧾",
  Item: "🥬",
};

export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Every request gets a number; only the newest one is allowed to set state.
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) { setHits([]); setLoading(false); return; }

    const mine = ++latest.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      globalSearch(q)
        .then((result) => {
          if (mine !== latest.current) return;
          setHits(result);
          setActive(0);
          setOpen(true);
        })
        .catch(() => { if (mine === latest.current) setHits([]); })
        .finally(() => { if (mine === latest.current) setLoading(false); });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  // Clicking elsewhere closes it.
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function go(hit: SearchHitDto) {
    setOpen(false);
    setQuery("");
    setHits([]);
    inputRef.current?.blur();
    navigate(hit.url);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    // Enter goes to whatever is highlighted, so the whole thing works without the mouse — which
    // matters on the counter laptop, where both hands are already on the keyboard entering invoices.
    else if (event.key === "Enter") { event.preventDefault(); go(hits[active]); }
  }

  const showPanel = open && query.trim().length >= MIN_CHARS;

  return (
    // min-w-0: a flex child will not shrink below its content's intrinsic width unless told it
    // may, and an <input> carries a browser default of about twenty characters. Without it this
    // box refused to shrink and pushed the whole bar — and with it the page — past the screen.
    <div className="relative flex-1 min-w-0 max-w-md" ref={boxRef}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="🔍 دوّر على اسم أو رقم"
        aria-label="بحث"
        className="w-full rounded-md bg-brand-800 text-white placeholder:text-brand-300 border border-brand-700 px-3 py-1.5 text-sm focus:outline-none focus:border-brand-400"
      />

      {showPanel && (
        <div className="absolute top-full mt-2 start-0 end-0 z-50 bg-white text-gray-900 rounded-lg shadow-xl border border-gray-200 overflow-hidden">
          {loading && hits.length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-400 text-center">جاري البحث...</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-400 text-center">ما في نتائج</div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {hits.map((hit, index) => (
                <li key={`${hit.kind}-${hit.id}-${hit.url}`}>
                  <button
                    type="button"
                    className={`w-full text-start px-3 py-2.5 flex items-center gap-3 ${index === active ? "bg-brand-50" : "hover:bg-gray-50"}`}
                    // Mouse and keyboard agree on what is highlighted, rather than fighting over it.
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(hit)}
                  >
                    <span className="shrink-0">{KIND_ICON[hit.kind] ?? "•"}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{hit.title}</span>
                      <span className="block text-xs text-gray-500 truncate">{hit.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
