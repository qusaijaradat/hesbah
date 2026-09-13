/**
 * Runs the scan-paste and voice parsers. Same reason as the other two check scripts: this
 * environment cannot restore a test runner, and a check nobody can run is a comment.
 *
 *   npm run check:capture        (from frontend/)
 */
import { matchName, parseScannedRows, parseSpokenRow } from "../src/lib/ledgerCapture.js";
import type { KnownNames } from "../src/lib/ledgerCapture.js";

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

const known: KnownNames = {
  items: ["بندورة", "خيار", "باذنجان"],
  partners: [
    { id: 1, name: "أبو علي" },
    { id: 2, name: "أبو علي الثاني" },
    { id: 3, name: "سالم الشوبكي" },
    { id: 4, name: "خالد" },
  ],
};

console.log("== matching a rough reading to what is on file ==");
check("an exact name wins even when another contains it",
  matchName("أبو علي", known.partners)?.id === 1);
check("spelling differences fold away",
  matchName("ابو علي الثاني", known.partners)?.id === 2);
check("a partial name that fits only one person matches",
  matchName("شوبك", known.partners)?.id === 3);
// Two people fitting is exactly when a machine must not choose.
check("a partial name that fits two matches nothing",
  matchName("ابو", known.partners) === null);
check("a name nobody has matches nothing",
  matchName("زياد", known.partners) === null);

console.log("\n== a pasted page ==");
{
  const rows = parseScannedRows("أبو علي\tبندورة\t10\t\t3.5\tخالد\tسالم الشوبكي\t10", known);
  check("one line becomes one row", rows.length === 1);
  check("the buyer is linked, not just typed", rows[0].merchant?.id === 1, JSON.stringify(rows[0].merchant));
  check("the seller is linked too", rows[0].farmer?.id === 3);
  check("the driver is linked too", rows[0].driver?.id === 4);
  check("the item comes back as the catalogue spells it", rows[0].itemName === "بندورة");
  check("numbers land in their own columns", rows[0].quantity === "10" && rows[0].pricePerUnit === "3.5");
  check("an empty cell stays empty", rows[0].weightKg === "");
}
{
  // A name nobody has is kept as text — the audit already warns that saving would create them.
  const rows = parseScannedRows("أبو نضال\tبندورة\t5\t\t2", known);
  check("an unknown name is kept as text", rows[0].merchantText === "أبو نضال" && rows[0].merchant === null);
}
{
  const rows = parseScannedRows(
    ["الصنف,المشتري,السعر,العدد", "خيار,أبو علي,12,40"].join("\n"), known);
  check("a header row is used, so reordered columns still land right",
    rows.length === 1 && rows[0].itemName === "خيار" && rows[0].pricePerUnit === "12" && rows[0].quantity === "40",
    JSON.stringify(rows[0]));
}
{
  // A buyer who happens to be called "عدد" must not make the first data row disappear as a header.
  const rows = parseScannedRows("عدد,بندورة,5,,2", known);
  check("a data row is not eaten as a header", rows.length === 1 && rows[0].merchantText === "عدد");
}
{
  const rows = parseScannedRows("أبو علي\tبندورة\t١٠\t\t٣٫٥".replace("٫", "."), known);
  check("Arabic-Indic digits become numbers", rows[0].quantity === "10");
}
check("blank input produces no rows", parseScannedRows("   \n\n  ", known).length === 0);

console.log("\n== a spoken row ==");
{
  const r = parseSpokenRow("أبو علي بندورة عدد 20 بسعر 3.5 صناديق 10", known);
  check("the buyer is recognised", r.merchant?.id === 1);
  check("the item is recognised", r.itemName === "بندورة");
  check("عدد takes the number after it", r.quantity === "20");
  check("سعر takes its own", r.pricePerUnit === "3.5");
  check("صناديق takes its own", r.boxQuantity === "10");
}
{
  // The cue can follow the number as easily as precede it.
  const r = parseSpokenRow("بندورة 12 صندوق", known);
  check("a trailing cue counts", r.boxQuantity === "12", JSON.stringify(r));
}
{
  // The whole point of cue-led parsing: an unexplained number is not money.
  const r = parseSpokenRow("أبو علي بندورة 20", known);
  check("a number with no cue is left out", r.quantity === undefined && r.pricePerUnit === undefined,
    JSON.stringify(r));
  check("but the names it did recognise still come through", r.itemName === "بندورة" && r.merchant?.id === 1);
}
{
  const r = parseSpokenRow("سالم الشوبكي وأبو علي خيار عدد 5", known);
  check("two names named means neither is assumed", r.merchant === undefined, JSON.stringify(r.merchantText));
  check("and the rest of the sentence is still read", r.itemName === "خيار" && r.quantity === "5");
}
{
  const r = parseSpokenRow("باذنجان وزن 75.25 كيلو سعر 2.75", known);
  check("وزن and سعر are told apart", r.weightKg === "75.25" && r.pricePerUnit === "2.75", JSON.stringify(r));
}
{
  // iPhone dictation is the main voice path on iOS — Safari has no speech API — and an Arabic
  // keyboard dictating Arabic types Arabic-Indic digits.
  const r = parseSpokenRow("أبو علي بندورة عدد ٢٠ بسعر ٣.٥ صناديق ١٠", known);
  check("dictated Arabic-Indic digits are read",
    r.quantity === "20" && r.pricePerUnit === "3.5" && r.boxQuantity === "10", JSON.stringify(r));
  check("and the names come through with them", r.itemName === "بندورة" && r.merchant?.id === 1);
}
check("an empty transcript fills nothing", Object.keys(parseSpokenRow("", known)).length === 0);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
// No @types/node in this project (it is a browser app), so the exit code is set through the
// global rather than a typed `process`.
declare const process: { exitCode?: number };
process.exitCode = failed === 0 ? 0 : 1;
