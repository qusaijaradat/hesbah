/*
 * Nothing in this app may scroll sideways.
 *
 * `body { overflow-x: clip }` in index.css is the backstop, and a backstop is exactly the wrong
 * place to find out about a layout bug: it HIDES the overflow, so a row too wide for a phone stops
 * announcing itself and quietly loses its right-hand end instead. This reads the source and fails
 * on the shapes that cause it, so it is caught where it was written.
 *
 * Four rules, all mechanical. Each one is a real bug that was found by hand first: a table that
 * was not hidden, a search box that could not shrink, six selection bars that could not wrap.
 *
 *   node tools/responsiveCheck.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");

/** Tailwind's width scale, in px, from the point where a phone starts to care. */
const WIDTH_PX = {
  40: 160, 44: 176, 48: 192, 52: 208, 56: 224, 60: 240, 64: 256, 72: 288, 80: 320, 96: 384,
};

/**
 * Lines that look like a violation and are not. Each carries its reason, because an allowlist
 * without reasons becomes the place rules go to die.
 */
const ALLOWED = [
  // The desktop sidebar: `hidden md:flex`. It does not exist on a phone.
  { file: "components/Layout.tsx", contains: "hidden md:flex w-64" },
  // The mobile drawer, already capped at 80% of whatever screen it opens on.
  { file: "components/Layout.tsx", contains: "w-64 max-w-[80%]" },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(entry.name)) out.push(p);
  }
  return out;
}

const failures = [];
function fail(where, rule, detail) {
  failures.push({ where, rule, detail });
}

for (const abs of walk(ROOT)) {
  const rel = path.relative(path.join(__dirname, ".."), abs).split(path.sep).join("/");
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

  lines.forEach((line, i) => {
    const where = rel + ":" + (i + 1);
    if (ALLOWED.some((a) => rel.endsWith(a.file) && line.includes(a.contains))) return;

    // ---- 1. A table must be hidden below sm. They are ten columns wide by nature, and every one
    //         of them has a card or stacked-list half beside it (components/CollapsibleRows).
    if (line.includes("<table")) {
      const above = lines.slice(Math.max(0, i - 3), i).join("\n");
      if (!above.includes("hidden sm:block")) {
        fail(where, "table-visible-on-phone", "no `hidden sm:block` wrapper directly above it");
      }
    }

    // Everything below is about how a line lays out on a phone, and a table cell never does —
    // rule 1 has just proved every table is hidden there. Without this the desktop-only ledger
    // grid, whose columns are sized in px on purpose, would trip every rule that follows.
    if (/^\s*<(th|td)[\s>]/.test(line)) return;

    // ---- 2. A fixed width of 10rem or more, unprefixed, is a floor under the row and then the page.
    for (const m of line.matchAll(/(?<![a-z:-])(min-)?w-(\d+)(?![\w-])/g)) {
      const px = WIDTH_PX[m[2]];
      if (px) fail(where, "fixed-width-on-phone", m[0] + " is " + px + "px with no sm:/md: prefix");
    }
    for (const m of line.matchAll(/(?<![a-z:-])min-w-\[([0-9.]+)rem\]/g)) {
      const px = parseFloat(m[1]) * 16;
      if (px >= 240) fail(where, "fixed-width-on-phone", m[0] + " is " + px + "px with no sm:/md: prefix");
    }

    // ---- 3. More than three fixed grid columns does not fit a phone.
    for (const m of line.matchAll(/(?<![a-z:-])grid-cols-([4-9]|1[0-9])(?![\w-])/g)) {
      fail(where, "rigid-grid-on-phone", m[0] + " with no sm:/md: prefix");
    }

    // ---- 4. A flex child holding a form control must be allowed to shrink. An <input> carries a
    //         browser default of about twenty characters, and without min-w-0 that width becomes
    //         the minimum width of the row, and then of the page. This is exactly what the search
    //         box in the app bar did.
    const cls = (line.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/) || [])[1] || "";
    if (/(^|\s)(flex-1|grow)(\s|$)/.test(cls) && !/min-w-0/.test(cls)) {
      const block = lines.slice(i, i + 6).join("\n");
      if (/<input|<select|<textarea|className="input/.test(block)) {
        fail(where, "unshrinkable-input", "flex-1/grow around a form control without min-w-0");
      }
    }
  });
}

if (failures.length === 0) {
  console.log("RESULT: nothing that can push a page sideways");
  process.exit(0);
}

for (const f of failures) console.log("  [FAIL] " + f.where + "  " + f.rule + " — " + f.detail);
console.log("\nRESULT: " + failures.length + " thing(s) that can push a page sideways");
process.exit(1);
