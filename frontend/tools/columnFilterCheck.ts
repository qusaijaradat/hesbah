/**
 * Runs the per-column table filters against rows shaped like the app's real ones.
 *
 * Same reason as tools/ledgerAuditCheck.ts: this environment cannot restore a test runner (see
 * docs/DEVELOPMENT_NOTES.md), and a check nobody can run is a comment.
 *
 *   npm run check:filters        (from frontend/)
 */
import {
  activeFilterCount, applyColumnFilters, derivedOptions, isFilterEmpty, normalizeArabic,
} from "../src/lib/columnFilters.js";
import type { ColumnFilterSpec, ColumnFilterState } from "../src/lib/columnFilters.js";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Row {
  id: number;
  name: string;
  type: string;
  balance: number;
  date: string;
  active: boolean;
}

const rows: Row[] = [
  { id: 1, name: "أبو عليّ", type: "مشتري", balance: 1200, date: "2026-03-04T08:00:00+02:00", active: true },
  { id: 2, name: "سالم الشوبكي", type: "بائع", balance: -300, date: "2026-03-09T20:00:00+02:00", active: true },
  { id: 3, name: "خالد", type: "بائع/سائق", balance: 0, date: "2026-04-01T06:30:00+02:00", active: false },
  { id: 4, name: "ابو علي الثاني", type: "مشتري", balance: 9500, date: "2026-04-20T12:00:00+02:00", active: true },
];

const SPECS: ColumnFilterSpec<Row>[] = [
  { key: "name", kind: "text", value: (r) => r.name },
  { key: "type", kind: "select", value: (r) => r.type },
  { key: "balance", kind: "numberRange", value: (r) => r.balance },
  { key: "date", kind: "dateRange", value: (r) => r.date },
  { key: "active", kind: "boolean", value: (r) => r.active },
];

const f = (state: ColumnFilterState) => applyColumnFilters(rows, SPECS, state).map((r) => r.id);

console.log("== Arabic folding ==");
check("أ/إ/آ all fold to ا", normalizeArabic("أإآ") === "ااا");
check("ة folds to ه", normalizeArabic("حسبة") === "حسبه");
check("ى folds to ي", normalizeArabic("مصطفى") === "مصطفي");
check("diacritics are dropped", normalizeArabic("عَلِيّ") === "علي", normalizeArabic("عَلِيّ"));
check("Arabic-Indic digits become ASCII", normalizeArabic("٢٠٢٦") === "2026");
check("case and spacing are folded", normalizeArabic("  ABC   d ") === "abc d");

console.log("\n== nothing typed means nothing filtered ==");
check("an empty state returns every row", f({}).length === 4);
check("a blank string does not filter", f({ name: { a: "   " } }).length === 4);
check("isFilterEmpty agrees", isFilterEmpty({ a: "", b: "" }) && isFilterEmpty(undefined));
check("activeFilterCount ignores the blanks", activeFilterCount({ name: { a: " " }, type: { a: "بائع" } }) === 1);

console.log("\n== text: spelled differently is still the same name ==");
// The whole point: nobody types the hamza or the shadda, and the row is still theirs.
check("'ابو علي' finds 'أبو عليّ'", f({ name: { a: "ابو علي" } }).includes(1), JSON.stringify(f({ name: { a: "ابو علي" } })));
check("and also finds 'ابو علي الثاني'", f({ name: { a: "ابو علي" } }).length === 2);
check("a partial word matches", f({ name: { a: "شوبك" } }).join() === "2");
check("no match returns nothing, not everything", f({ name: { a: "زياد" } }).length === 0);

console.log("\n== select is exact, not contains ==");
// "بائع" must not drag in "بائع/سائق" — picking a role from a list is picking that role.
check("'بائع' does not also return 'بائع/سائق'", f({ type: { a: "بائع" } }).join() === "2");
check("'بائع/سائق' returns its own row", f({ type: { a: "بائع/سائق" } }).join() === "3");
check("options come from the rows, sorted, no blanks", derivedOptions(rows, SPECS[1]).length === 3);
check("declared options win over the rows",
  derivedOptions(rows, { key: "x", kind: "select", value: () => "", options: [{ value: "a", label: "A" }] }).length === 1);

console.log("\n== number range ==");
check("a floor alone", f({ balance: { a: "1000" } }).join() === "1,4");
check("a ceiling alone", f({ balance: { a: "", b: "0" } }).join() === "2,3");
check("both ends", f({ balance: { a: "0", b: "1200" } }).join() === "1,3");
// Both bounds are inclusive: a person typing "من 0 إلى 1200" means the rows that say 0 and 1200.
check("the bounds are inclusive", f({ balance: { a: "1200", b: "1200" } }).join() === "1");
check("a negative floor works", f({ balance: { a: "-500", b: "-1" } }).join() === "2");
check("Arabic-Indic digits work in a range", f({ balance: { a: "١٠٠٠" } }).join() === "1,4");

console.log("\n== date range ==");
// Compared as yyyy-mm-dd text. A row timestamped 20:00+02:00 must not slide into the previous
// day because something re-read it as UTC.
check("a late-evening row stays on its own day", f({ date: { a: "2026-03-09", b: "2026-03-09" } }).join() === "2");
check("from alone", f({ date: { a: "2026-04-01" } }).join() === "3,4");
check("to alone", f({ date: { a: "", b: "2026-03-31" } }).join() === "1,2");
check("a range spanning months", f({ date: { a: "2026-03-05", b: "2026-04-05" } }).join() === "2,3");

console.log("\n== boolean ==");
check("yes", f({ active: { a: "yes" } }).join() === "1,2,4");
check("no", f({ active: { a: "no" } }).join() === "3");

console.log("\n== filters narrow each other, never widen ==");
check("two filters intersect", f({ type: { a: "مشتري" }, balance: { a: "5000" } }).join() === "4");
check("an impossible combination returns nothing",
  f({ type: { a: "بائع" }, balance: { a: "5000" } }).length === 0);
check("a blank filter beside a real one is ignored",
  f({ type: { a: "مشتري" }, name: { a: "" } }).join() === "1,4");

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
// No @types/node in this project (it is a browser app), so the exit code is set through the
// global rather than a typed `process` — the runner still needs a non-zero exit on failure.
declare const process: { exitCode?: number };
process.exitCode = failed === 0 ? 0 : 1;
