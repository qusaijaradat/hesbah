/// <summary>
/// Small on/off switches for features that exist in the code but aren't wanted on-screen right
/// now. Kept separate from the components themselves so re-enabling one later is a one-line change
/// here, with no need to re-find/re-write the UI it controls.
/// </summary>

/** "الحد الائتماني" (credit limit) — field on the partner form, column in the partners list,
 * stat/warning on the merchant account page, and the "would exceed" warning on invoice new/edit.
 * Turned off 2026-09-04: not needed by the market right now. All the data/logic behind it is
 * untouched — flip this back to true to bring the whole feature back exactly as it was. */
export const CREDIT_LIMIT_UI_ENABLED = false;
