/**
 * Runs the "إدخال الدفتر" checks against pages built to look like real ones.
 *
 * Same reason the backend has tools/SmokeTests and no test framework: this environment cannot
 * restore a test runner (see docs/DEVELOPMENT_NOTES.md), and a check nobody can run is a comment.
 *
 *   npm run check:ledger        (from frontend/)
 */
import { auditRows, groupRows, isBlank } from "../src/lib/ledgerAudit.js";
import type { Finding, LedgerRow } from "../src/lib/ledgerAudit.js";

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

const P = (id: number, name: string) => ({ id, name });

function row(o: Partial<LedgerRow>): LedgerRow {
  return {
    merchant: null, merchantText: "", itemName: "", quantity: "", weightKg: "",
    pricePerUnit: "", driver: null, driverText: "", farmer: null, farmerText: "", boxQuantity: "",
    ...o,
  };
}

const msgs = (f: Finding[]) => f.map((x) => `${x.rowIndex}:${x.severity}:${x.message}`).join(" | ");
const has = (f: Finding[], i: number, sev: string, frag: string) =>
  f.some((x) => x.rowIndex === i && x.severity === sev && x.message.includes(frag));

console.log("== blank rows ==");
check("an untouched row is blank", isBlank(row({})));
check("one character makes it live", !isBlank(row({ quantity: "1" })));
check("blank rows produce no findings", auditRows([row({}), row({}), row({})]).length === 0);

console.log("\n== the errors that block a save ==");
{
  const f = auditRows([row({ itemName: "بندورة", quantity: "5", pricePerUnit: "3" })]);
  check("a row with no buyer is an error", has(f, 0, "error", "بدون مشتري"), msgs(f));
}
{
  const f = auditRows([row({ merchant: P(1, "أبو علي"), merchantText: "أبو علي", quantity: "5", pricePerUnit: "3" })]);
  check("a row with no item is an error", has(f, 0, "error", "بدون صنف"));
}
{
  const f = auditRows([row({ merchant: P(1, "x"), merchantText: "x", itemName: "بندورة", quantity: "0", pricePerUnit: "3" })]);
  check("count 0 is an error", has(f, 0, "error", "العدد"));
}
{
  // A typed 0 weight is someone reaching for the field and leaving it, not a weighing that came
  // out empty — and the difference decides how the line is priced.
  const f = auditRows([row({ merchant: P(1, "x"), merchantText: "x", itemName: "بندورة", quantity: "5", weightKg: "0", pricePerUnit: "3" })]);
  check("a weight typed as 0 is an error", has(f, 0, "error", "الوزن مكتوب صفر"));
  const g = auditRows([row({ merchant: P(1, "x"), merchantText: "x", itemName: "بندورة", quantity: "5", weightKg: "", pricePerUnit: "3" })]);
  check("an empty weight is fine", !g.some((x) => x.message.includes("الوزن")));
}

console.log("\n== warnings that do not block ==");
{
  const f = auditRows([row({ merchant: P(1, "x"), merchantText: "x", itemName: "بندورة", quantity: "5" })]);
  check("no price is a warning, not an error",
    has(f, 0, "warn", "بدون سعر") && !f.some((x) => x.severity === "error" && x.message.includes("سعر")));
}
{
  // The check that stops one seller becoming two records with two balances.
  const f = auditRows([row({ merchantText: "اسم جديد", itemName: "بندورة", quantity: "5", pricePerUnit: "3" })]);
  check("an unmatched buyer name warns that it will create a new one", has(f, 0, "warn", "مشتري جديد"));
  const g = auditRows([row({ merchant: P(7, "أبو علي"), merchantText: "أبو علي", itemName: "بندورة", quantity: "5", pricePerUnit: "3" })]);
  check("a matched name does not warn", !g.some((x) => x.message.includes("جديد")));
}

console.log("\n== the misplaced decimal point ==");
{
  const page = [
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "10", pricePerUnit: "3.5" }),
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "12", pricePerUnit: "3.4" }),
    row({ merchant: P(2, "b"), merchantText: "b", itemName: "بندورة", quantity: "8", pricePerUnit: "3.6" }),
    row({ merchant: P(2, "b"), merchantText: "b", itemName: "بندورة", quantity: "9", pricePerUnit: "35" }),
  ];
  const f = auditRows(page);
  check("the row with the extra zero is flagged", has(f, 3, "warn", "بعيد كتير"), msgs(f));
  check("the ordinary rows are not", !has(f, 0, "warn", "بعيد كتير") && !has(f, 1, "warn", "بعيد كتير"));
}
{
  // Too few rows of an item and the page cannot say what it went for — better silent than crying wolf.
  const f = auditRows([
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "نعنع", quantity: "1", pricePerUnit: "2" }),
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "نعنع", quantity: "1", pricePerUnit: "90" }),
  ]);
  check("two rows of an item raise no outlier", !f.some((x) => x.message.includes("بعيد كتير")), msgs(f));
}
{
  // A genuinely expensive item among cheap ones must not be flagged just for being different.
  const f = auditRows([
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "1", pricePerUnit: "3" }),
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "1", pricePerUnit: "3.5" }),
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "1", pricePerUnit: "3.2" }),
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "لوز", quantity: "1", pricePerUnit: "60" }),
  ]);
  check("a different ITEM at a different price is not an outlier", !has(f, 3, "warn", "بعيد كتير"), msgs(f));
}

console.log("\n== the same line twice ==");
{
  const same = { merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "10", pricePerUnit: "3.5" };
  const f = auditRows([row(same), row(same)]);
  check("an identical repeat is flagged on the SECOND row", has(f, 1, "warn", "مكرر"), msgs(f));
  check("and not on the first", !has(f, 0, "warn", "مكرر"));
}
{
  const f = auditRows([
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "10", pricePerUnit: "3.5" }),
    row({ merchant: P(1, "a"), merchantText: "a", itemName: "بندورة", quantity: "11", pricePerUnit: "3.5" }),
  ]);
  check("two real rows of the same item are not 'duplicate'", !f.some((x) => x.message.includes("مكرر")));
}

console.log("\n== grouping a mixed page into invoices ==");
{
  // The shape of a real page: buyers and sellers interleaved down it.
  const page = [
    row({ merchant: P(1, "أبو علي"), merchantText: "أبو علي", farmer: P(9, "سامي"), farmerText: "سامي", itemName: "بندورة", quantity: "10", pricePerUnit: "3" }),
    row({ merchant: P(2, "أبو خالد"), merchantText: "أبو خالد", farmer: P(9, "سامي"), farmerText: "سامي", itemName: "خيار", quantity: "5", pricePerUnit: "12" }),
    row({ merchant: P(1, "أبو علي"), merchantText: "أبو علي", farmer: P(9, "سامي"), farmerText: "سامي", itemName: "نعنع", quantity: "7", pricePerUnit: "2" }),
    row({ merchant: P(1, "أبو علي"), merchantText: "أبو علي", farmer: P(8, "خالد"), farmerText: "خالد", itemName: "بندورة", quantity: "4", pricePerUnit: "3" }),
    row({}),
  ];
  const g = groupRows(page);
  check("four live rows across three (buyer, seller) pairs => 3 invoices", g.length === 3, `got ${g.length}`);
  const biggest = g.find((x) => x.length === 2);
  check("the two rows for the same pair land in one invoice", !!biggest);
  check("and they are the right two", !!biggest && biggest[0].itemName === "بندورة" && biggest[1].itemName === "نعنع");
  check("a blank row joins no invoice", g.flat().length === 4);
}
{
  // Same buyer and seller, different driver: a different invoice, because the driver is paid per one.
  const g = groupRows([
    row({ merchant: P(1, "a"), merchantText: "a", farmer: P(9, "s"), farmerText: "s", driver: P(5, "d1"), driverText: "d1", itemName: "x", quantity: "1" }),
    row({ merchant: P(1, "a"), merchantText: "a", farmer: P(9, "s"), farmerText: "s", driver: P(6, "d2"), driverText: "d2", itemName: "y", quantity: "1" }),
  ]);
  check("a different driver splits the invoice", g.length === 2, `got ${g.length}`);
}
{
  // A name typed but never picked still has to group with itself, or one buyer becomes two invoices.
  const g = groupRows([
    row({ merchantText: " أبو عمار ", itemName: "x", quantity: "1" }),
    row({ merchantText: "أبو عمار", itemName: "y", quantity: "1" }),
  ]);
  check("the same typed name groups together despite spacing", g.length === 1, `got ${g.length}`);
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
// No @types/node in this project (it is a browser app), so the exit code is set through the
// global rather than a typed `process` — the runner still needs a non-zero exit on failure.
declare const process: { exitCode?: number };
process.exitCode = failed === 0 ? 0 : 1;
