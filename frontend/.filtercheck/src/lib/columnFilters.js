/**
 * Per-column filtering for the app's tables — the matching itself, with no React in it, so it can
 * be run by tools/columnFilterCheck.ts the same way ledgerAudit is.
 *
 * One filter row sits under the table header; each column says what it filters on and how. The
 * filtering is CLIENT-side, over the rows the page already has, which is the right shape for every
 * table here except one: الفواتير is paged by the server (25 at a time), so filtering what happens
 * to be loaded there would quietly answer a question about page 3 as though it were a question
 * about the whole year. That page filters through its existing server-side InvoiceFilterRequest
 * instead and does not use this module for the fields the server understands.
 *
 * Arabic matching is normalized, not literal: someone typing "ابو علي" must find "أبو عليّ". The
 * folding here is the same one KeywordAskPlanner applies on the backend — أ/إ/آ→ا, ة→ه, ى→ي,
 * Arabic-Indic digits→ASCII, diacritics dropped — because the two would otherwise disagree about
 * whether a name matched, and only one of them would be on screen to argue with.
 */
const ARABIC_INDIC_ZERO = 0x0660;
/**
 * Fold the differences that are spelling, not meaning. Anything left after this is a real
 * difference between two strings.
 */
export function normalizeArabic(input) {
    let out = "";
    for (const ch of input.toLowerCase()) {
        const code = ch.codePointAt(0);
        // Arabic-Indic digits ٠-٩ → 0-9. A number typed on an Arabic keyboard is the same number.
        if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
            out += String.fromCharCode(48 + (code - ARABIC_INDIC_ZERO));
            continue;
        }
        // Diacritics (تشكيل) and the tatweel stretch carry no identity — drop them.
        if ((code >= 0x064b && code <= 0x0652) || code === 0x0640)
            continue;
        if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") {
            out += "ا";
            continue;
        }
        if (ch === "ة") {
            out += "ه";
            continue;
        }
        if (ch === "ى") {
            out += "ي";
            continue;
        }
        if (ch === "ؤ") {
            out += "و";
            continue;
        }
        if (ch === "ئ") {
            out += "ي";
            continue;
        }
        out += ch;
    }
    return out.replace(/\s+/g, " ").trim();
}
/** The text a `text`/`select` column matches against. null/undefined read as empty, never "null". */
function asText(v) {
    if (v === null || v === undefined)
        return "";
    if (typeof v === "boolean")
        return v ? "نعم" : "لا";
    return String(v);
}
/** A filter with nothing typed in it does not filter. */
export function isFilterEmpty(value) {
    if (!value)
        return true;
    return value.a.trim() === "" && (value.b ?? "").trim() === "";
}
/** How many columns are actually narrowing the table right now — for a "مسح الفلاتر (3)" button. */
export function activeFilterCount(state) {
    return Object.values(state).filter((v) => !isFilterEmpty(v)).length;
}
function matchesOne(row, spec, value) {
    const raw = spec.value(row);
    switch (spec.kind) {
        case "text":
            return normalizeArabic(asText(raw)).includes(normalizeArabic(value.a));
        // Exact, not "contains": picking "بائع" from a list must not also return "بائع/سائق".
        case "select":
            return asText(raw) === value.a;
        case "boolean":
            return value.a === "yes" ? raw === true : raw === false;
        case "numberRange": {
            const n = typeof raw === "number" ? raw : parseFloat(asText(raw));
            if (!Number.isFinite(n))
                return false;
            const min = parseFloat(normalizeArabic(value.a));
            const max = parseFloat(normalizeArabic(value.b ?? ""));
            if (Number.isFinite(min) && n < min)
                return false;
            if (Number.isFinite(max) && n > max)
                return false;
            return true;
        }
        // Compared as yyyy-mm-dd strings, which sort correctly and — unlike `new Date(...)` — cannot
        // move a row across a day boundary because the browser read a timestamp in another timezone.
        case "dateRange": {
            const day = asText(raw).slice(0, 10);
            if (day === "")
                return false;
            const from = value.a.trim();
            const to = (value.b ?? "").trim();
            if (from !== "" && day < from)
                return false;
            if (to !== "" && day > to)
                return false;
            return true;
        }
    }
}
/** Rows matching EVERY non-empty filter. Filters narrow each other; they never widen. */
export function applyColumnFilters(rows, specs, state) {
    const live = specs.filter((s) => !isFilterEmpty(state[s.key]));
    if (live.length === 0)
        return rows;
    return rows.filter((row) => live.every((spec) => matchesOne(row, spec, state[spec.key])));
}
/**
 * The options a `select` column offers when it did not declare its own: every distinct value
 * present in the rows, sorted the way Arabic sorts. Blank values are left out — "no value" is not
 * something to pick, and a column full of them would offer an empty line to choose.
 */
export function derivedOptions(rows, spec) {
    if (spec.options)
        return spec.options;
    const seen = new Set();
    for (const row of rows) {
        const text = asText(spec.value(row)).trim();
        if (text !== "")
            seen.add(text);
    }
    return Array.from(seen)
        .sort((a, b) => a.localeCompare(b, "ar"))
        .map((value) => ({ value, label: value }));
}
