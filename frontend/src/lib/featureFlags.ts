/// <summary>
/// Small on/off switches for features that exist in the code but aren't wanted on-screen right
/// now. Kept separate from the components themselves so re-enabling one later is a one-line change
/// here, with no need to re-find/re-write the UI it controls.
/// </summary>

/**
 * "الحد الائتماني" (credit limit) — field on the partner form, column in the partners list,
 * stat/warning on the merchant account page, and the "would exceed" warning on invoice new/edit.
 *
 * Off 2026-09-04 ("not needed by the market right now"), back on 2026-09-16 at the market's
 * request. Nothing behind it ever changed, which is what this switch is for.
 *
 * Worth knowing before it is on: every part of it WARNS and nothing BLOCKS. An invoice that puts
 * a buyer past his limit still saves — the form just says so first. Deliberately: a market does
 * not stop selling to a regular at the gate because a number was typed into a settings field
 * months ago, and a limit that refuses work gets worked around rather than respected.
 *
 * It also shows nothing until somebody sets a limit on somebody. An empty field means no limit,
 * so turning this on changes no screen until a limit is actually typed in.
 */
export const CREDIT_LIMIT_UI_ENABLED = true;
