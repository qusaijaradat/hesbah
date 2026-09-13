// ".js" so the emitted module resolves under plain Node too — that is how
// tools/ledgerCaptureCheck.ts runs this file. Vite and tsc both read it as the .ts source.
import { normalizeArabic } from "./columnFilters.js";
import type { LedgerRow } from "./ledgerAudit";

/**
 * Turning something a person produced — a scanned page read back as text, or a sentence spoken at
 * the stall — into rows of "إدخال الدفتر".
 *
 * Pure, and kept out of the screen so it can be run by tools/ledgerCaptureCheck.ts. Both entry
 * points are guesses at what somebody meant, and a guess about money is exactly the kind of thing
 * that has to be checked by something other than reading it.
 *
 * Two rules hold for both of them:
 *
 *  1. NOTHING here saves anything. Both return rows for the grid, where the existing audit runs
 *     over them and a person presses the button. A machine reading of a price is not a price.
 *  2. A field it is not sure about is left EMPTY rather than filled with its best guess. An empty
 *     cell is a question; a wrongly filled one looks like an answer.
 */

/** What is already on file, so a rough reading can be matched to it instead of read cold. */
export interface KnownNames {
  items: string[];
  partners: { id: number; name: string }[];
}

/** The columns a captured row can carry, in the order the paste format expects them. */
const PASTE_COLUMNS = [
  "merchant", "itemName", "quantity", "weightKg", "pricePerUnit",
  "driver", "farmer", "boxQuantity", "cartonQuantity", "woodPrice", "transportFee",
] as const;

/** Header words that identify a paste's columns when it carries a header row. */
const HEADER_WORDS: Record<string, (typeof PASTE_COLUMNS)[number]> = {
  "المشتري": "merchant", "مشتري": "merchant",
  "الصنف": "itemName", "صنف": "itemName",
  "العدد": "quantity", "عدد": "quantity", "الكمية": "quantity",
  "الوزن": "weightKg", "وزن": "weightKg",
  "السعر": "pricePerUnit", "سعر": "pricePerUnit",
  "السائق": "driver", "سائق": "driver",
  "البائع": "farmer", "بائع": "farmer",
  "الصناديق": "boxQuantity", "صناديق": "boxQuantity",
  "الكرتون": "cartonQuantity", "كرتون": "cartonQuantity",
  "الخشب": "woodPrice", "خشب": "woodPrice",
  "النقل": "transportFee", "نقل": "transportFee",
};

function blankRow(): LedgerRow {
  return {
    merchant: null, merchantText: "", itemName: "", quantity: "", weightKg: "",
    pricePerUnit: "", driver: null, driverText: "", farmer: null, farmerText: "", boxQuantity: "",
    cartonQuantity: "", woodPrice: "", transportFee: "",
  };
}

/** Arabic-Indic digits fold to ASCII; everything that is not a number becomes "". */
function numberText(raw: string): string {
  const folded = normalizeArabic(raw).replace(/[^\d.\-]/g, "");
  return /^-?\d*\.?\d+$/.test(folded) ? folded : "";
}

/**
 * The one name on file this text means — or nothing.
 *
 * Exact match on the folded name first, then a unique containment either way ("ابو علي" finding
 * "أبو علي الثاني", or a transcript sentence containing a name). Ambiguity returns null on purpose:
 * two people whose names both fit is precisely when a machine must not choose.
 */
export function matchName<T extends { name: string }>(text: string, candidates: T[]): T | null {
  const needle = normalizeArabic(text);
  if (needle === "") return null;

  const exact = candidates.filter((c) => normalizeArabic(c.name) === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const loose = candidates.filter((c) => {
    const name = normalizeArabic(c.name);
    return name.includes(needle) || needle.includes(name);
  });
  return loose.length === 1 ? loose[0] : null;
}

// ---------------------------------------------------------------------------- scanned pages

/**
 * Rows from a pasted page: one line per row, columns separated by tabs, commas or a pipe.
 *
 * A header row is optional and is used when present — so a page whose columns came back in a
 * different order still lands in the right cells instead of silently shifting every number one
 * column to the left.
 *
 * Names are matched against what is on file and only linked when exactly one thing fits; otherwise
 * the text is kept and the row's audit will say "مش من القائمة — رح ينضاف جديد", which is the
 * warning that already exists for a name typed by hand.
 */
export function parseScannedRows(text: string, known: KnownNames): LedgerRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return [];

  const split = (line: string) => line.split(/\t|\||,|؛|;/).map((c) => c.trim());

  let columns: (typeof PASTE_COLUMNS)[number][] = [...PASTE_COLUMNS];
  let start = 0;
  const first = split(lines[0]);
  const mapped = first.map((c) => HEADER_WORDS[normalizeArabic(c)] ?? HEADER_WORDS[c.trim()]);
  // A header only counts as one when MOST of it is recognisable — a data row whose buyer happens
  // to be called "عدد" should not be eaten as a header.
  if (mapped.filter(Boolean).length >= Math.ceil(first.length / 2)) {
    columns = mapped.map((m, i) => m ?? PASTE_COLUMNS[i]).filter(Boolean) as typeof columns;
    start = 1;
  }

  const rows: LedgerRow[] = [];
  for (const line of lines.slice(start)) {
    const cells = split(line);
    const row = blankRow();
    let touched = false;

    cells.forEach((cell, i) => {
      const column = columns[i];
      if (!column || cell === "" || cell === "—" || cell === "-") return;
      touched = true;

      switch (column) {
        case "itemName": {
          const item = matchName(cell, known.items.map((name) => ({ name })));
          row.itemName = item ? item.name : cell;
          break;
        }
        case "merchant": {
          const p = matchName(cell, known.partners);
          row.merchant = p; row.merchantText = p ? p.name : cell;
          break;
        }
        case "farmer": {
          const p = matchName(cell, known.partners);
          row.farmer = p; row.farmerText = p ? p.name : cell;
          break;
        }
        case "driver": {
          const p = matchName(cell, known.partners);
          row.driver = p; row.driverText = p ? p.name : cell;
          break;
        }
        default:
          row[column] = numberText(cell);
      }
    });

    if (touched) rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------- spoken rows

/**
 * The word that has to appear before a number for it to be believed, per field.
 *
 * Cue-led rather than positional. "أبو علي بندورة عشرين بتلاتة" could put 20 in العدد or in
 * الصناديق depending on what the speaker meant, and a parser that decided by position would be
 * right most of the time and wrong about money the rest of it. A number with no cue in front of it
 * is dropped.
 */
const CUES: { cues: string[]; field: "quantity" | "weightKg" | "pricePerUnit" | "boxQuantity" | "cartonQuantity" | "transportFee" }[] = [
  { cues: ["عدد", "كميه", "كميت"], field: "quantity" },
  { cues: ["وزن", "كيلو", "كغم", "كجم"], field: "weightKg" },
  // No bare "ب" here. It is one letter and it lives inside half the words in the language, so a
  // lastIndexOf for it found a "ب" in "بندورة" and called the next number a price. The attached
  // form people actually say — "بـ3.5" — is handled below by looking at the character touching
  // the digits, which cannot match a letter in the middle of some other word.
  { cues: ["سعر", "بسعر"], field: "pricePerUnit" },
  { cues: ["صندوق", "صناديق", "صندق"], field: "boxQuantity" },
  { cues: ["كرتون", "كرتونه", "كراتين"], field: "cartonQuantity" },
  { cues: ["نقل", "اجره", "اجرة", "توصيله"], field: "transportFee" },
];

/**
 * One spoken sentence into the fields it names.
 *
 * Browsers hand back digits for spoken numbers, which is why this reads digits and does not try to
 * understand "عشرين" — where a browser returns the word instead, the field stays empty and the
 * person fills it, rather than the parser inventing a number.
 *
 * Everything it fills is a guess. It fills only what a cue word vouches for, and names only when
 * exactly one person or item on file fits.
 */
export function parseSpokenRow(transcript: string, known: KnownNames): Partial<LedgerRow> {
  const text = normalizeArabic(transcript);
  if (text === "") return {};

  const out: Partial<LedgerRow> = {};

  // Numbers, each attributed to the cue word closest in front of it.
  const numberPattern = /(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = numberPattern.exec(text))) {
    const before = text.slice(0, m.index);
    let best: { field: typeof CUES[number]["field"]; at: number } | null = null;
    for (const { cues, field } of CUES) {
      for (const cue of cues) {
        const at = before.lastIndexOf(cue);
        // The cue has to be IN FRONT of the number and close to it — "سعر" five words back is
        // describing something else by the time this number arrives.
        if (at >= 0 && before.length - at <= 14 && (!best || at > best.at)) best = { field, at };
      }
    }
    // "بـ3.5" / "ب3.5": a ب touching the digits is the spoken "at", and nothing else it could be.
    if (!best) {
      const touching = text.slice(0, m.index).replace(/[ـs]+$/, "");
      if (touching.endsWith("ب")) best = { field: "pricePerUnit", at: m.index };
    }
    // A trailing cue also counts: "عشرين صندوق" says صناديق just as clearly as "صناديق عشرين".
    if (!best) {
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
      for (const { cues, field } of CUES) {
        for (const cue of cues) {
          if (cue.length > 1 && after.trimStart().startsWith(cue)) best = { field, at: m.index };
        }
      }
    }
    if (best && !out[best.field]) out[best.field] = m[0];
  }

  const item = known.items.map((name) => ({ name })).find((c) => text.includes(normalizeArabic(c.name)));
  if (item) out.itemName = item.name;

  // Whoever is named goes in as the BUYER, the one column a notebook page changes every row. A
  // sentence naming two people is left for the person to sort out rather than guessed at.
  const named = known.partners.filter((p) => text.includes(normalizeArabic(p.name)));
  if (named.length === 1) {
    out.merchant = named[0];
    out.merchantText = named[0].name;
  }

  return out;
}
