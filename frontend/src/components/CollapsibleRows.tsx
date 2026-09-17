import { useState } from "react";

interface Props<T> {
  rows: T[];
  /** Stable key per row. */
  rowKey: (row: T) => string | number;
  /**
   * The one or two facts that identify the row — a name, a date — shown on the closed card. Keep it
   * to what someone scans for; everything else belongs in `details`.
   */
  title: (row: T) => React.ReactNode;
  /** The headline figure, shown on the right of the closed card. */
  value?: (row: T) => React.ReactNode;
  /** The rest of the columns, as label/value pairs, revealed when the card is opened. */
  details: (row: T) => { label: string; value: React.ReactNode }[];
  /**
   * Rendered to the side of the title and OUTSIDE the toggle — a selection checkbox, typically.
   * Outside because an input nested in a button is invalid HTML and, worse, a checkbox that also
   * opens the card means every attempt to tick one does two things.
   */
  leading?: (row: T) => React.ReactNode;
  /**
   * Rendered at the END of the closed card's line and, like `leading`, OUTSIDE the toggle — for
   * the one thing a card almost always needs and a button cannot hold: a link to the record the
   * row is about.
   *
   * An <a> inside a <button> is invalid HTML, and browsers act on that: the button's handler
   * runs and the navigation is swallowed, so the reference silently does nothing on a phone
   * while working perfectly in the table beside it. Putting it here is the fix.
   */
  trailing?: (row: T) => React.ReactNode;
  empty?: string;
}

/**
 * A table's rows as cards that open and close — the phone half of every table in this app.
 *
 * Sideways scrolling was the first answer and it was the wrong one. It keeps a table honest (the
 * columns stay columns) but it hides the columns that matter behind a gesture nobody makes, so a
 * row with eight figures on it reads as a row with two.
 *
 * So below 640px a row becomes a card: the name and the number that matters, and a tap for the
 * rest. Above it, the page keeps its real table — on a screen wide enough to hold one, a table is
 * still the better thing, because comparing a column DOWN the page is what tables are for and no
 * stack of cards does it.
 *
 * Which means every screen using this renders both and hides one. That is the cost, and it is
 * accepted deliberately: the alternative is one layout that is a compromise on both.
 */
export function CollapsibleRows<T>({ rows, rowKey, title, value, details, leading, trailing, empty }: Props<T>) {
  const [open, setOpen] = useState<Set<string | number>>(new Set());

  function toggle(key: string | number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (rows.length === 0) {
    return <div className="p-6 text-center text-gray-400 text-sm">{empty ?? "لا توجد بيانات"}</div>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {rows.map((row) => {
        const key = rowKey(row);
        const isOpen = open.has(key);
        const pairs = details(row);
        return (
          <div key={key}>
            {/* The toggle and anything beside it on one line; the detail list is a SIBLING of that
                line, not of the button — nested in the flex row it would open sideways. */}
            <div className="flex items-center">
            {leading && <div className="ps-3">{leading(row)}</div>}
            <button
              className="flex-1 min-w-0 flex items-center gap-2 px-3 py-3 text-start"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
            >
              {/* The chevron turns rather than swapping glyphs, so the control reads as one thing
                  in two states instead of two different buttons. */}
              <span className={`text-gray-400 text-xs transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
              <span className="flex-1 min-w-0 break-words font-medium">{title(row)}</span>
              {value && <span className="font-semibold whitespace-nowrap">{value(row)}</span>}
            </button>
            {/* Finger-sized on purpose: it sits against the card's edge, where a small target
                is either missed or hits the toggle instead. */}
            {trailing && <div className="pe-3 ps-1 py-2 text-sm whitespace-nowrap">{trailing(row)}</div>}
            </div>
            {isOpen && (
              <dl className="px-3 pb-3 ps-8 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {pairs.map((p) => (
                  <div key={p.label} className="contents">
                    <dt className="text-gray-500">{p.label}</dt>
                    <dd className="text-end">{p.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
