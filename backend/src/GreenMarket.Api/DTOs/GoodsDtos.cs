using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>One "إضافة بضاعة" intake record, as shown/edited on the "بضاعة الباعة" page.
/// Quantity is العدد and WeightKg is الوزن — the same pair an invoice line carries, so what was
/// taken in can actually be netted against what was sold. It used to be one number plus a Kg/Box
/// unit, which could say one or the other but never both.
/// WoodQuantity/SackQuantity are physical container counts for this delivery — independent of both
/// (a seller can bring 300 كغم of tomatoes in 3 wooden crates; "3" is a crate count, not 3 كغم), and
/// never validated against or displayed using the produce figures — see GoodsService.ValidateLine
/// and FarmerGoodsPage.tsx.</summary>
public record GoodsEntryDto(
    int Id, int FarmerId, string FarmerName, DateTimeOffset Date,
    string ItemName, decimal Quantity, decimal? WeightKg, decimal WoodQuantity, decimal SackQuantity, string? Notes);

/// <summary>FarmerId is required — unlike an invoice, a goods intake entry is always logged
/// against an already-known farmer (the page's own farmer picker doesn't allow typing a brand
/// new name), so there's no FarmerName find-or-create fallback here.</summary>
public record CreateGoodsEntryRequest(
    int FarmerId, DateTimeOffset Date, string ItemName,
    decimal Quantity, decimal? WeightKg = null, decimal WoodQuantity = 0, decimal SackQuantity = 0, string? Notes = null);

public record UpdateGoodsEntryRequest(
    DateTimeOffset Date, string ItemName,
    decimal Quantity, decimal? WeightKg = null, decimal WoodQuantity = 0, decimal SackQuantity = 0, string? Notes = null);

/// <summary>
/// One row of the "المتوفر حاليًا" (currently available) stock summary — per item + unit, across
/// ALL of this farmer's logged intake entries and ALL of his own Active invoices (not scoped to
/// any date range: "available right now" is always an all-time running total, same convention as
/// FarmerAccountDto's Remaining). TotalReceived/TotalSold are broken out on their own (not just
/// the net Available) for the same traceability reason every other account-style screen in this
/// app does that. Available going negative (sold more than was ever logged as received) is never
/// blocked anywhere — see FarmerGoodsEntry's doc comment — just shown so staff can spot and fix a
/// missed intake entry.
///
/// WoodReceived is a SEPARATE, independent figure — the running total of wooden-crate counts
/// logged against this item's intake entries (GoodsEntryDto.WoodQuantity), always a plain box/crate
/// count, independent of the produce figures. It is never netted against TotalSold —
/// there is no "wood crates sold" concept on the invoice side — so it simply reflects every wood
/// crate ever logged as received for this item, updating the moment a new intake entry adds to it.
///
/// FarmerId/FarmerName are populated ONLY by GoodsService.GetGlobalStockAsync (the "كل الباعة"
/// summary shown on "بضاعة الباعة"/"الإغلاق اليومي") — there, this row is scoped to one specific
/// farmer's own item+unit, not summed across every farmer, so the table can show whose stock each
/// row actually is. Both stay null on GetForFarmerAsync's own per-farmer Stock list, since that
/// page already shows the farmer's name once in its own header — repeating it on every row there
/// would be redundant.
/// </summary>
/// <summary>
/// One item's stock, counted BOTH ways at once: العدد and الوزن, each netted against its own kind.
/// A row used to be keyed by item + Kg/Box unit and carried one number, which meant produce taken
/// in by weight and sold by the crate became two unrelated rows that never subtracted from each
/// other. Whichever way a line was priced, it now contributes its count to one pair and its weight
/// (when it has one) to the other.
/// </summary>
public record GoodsStockRow(
    string ItemName,
    decimal TotalReceived, decimal TotalSold, decimal Available,
    decimal WeightReceived, decimal WeightSold, decimal WeightAvailable,
    decimal WoodReceived, decimal SackReceived, int? FarmerId = null, string? FarmerName = null);

/// <summary>Wraps a farmer's own name with both halves of the "بضاعة الباعة" page: the raw intake
/// log (Entries, newest first — editable/deletable) and the computed per-item stock summary
/// (Stock) that nets those entries against actual sales.</summary>
public record FarmerGoodsStockDto(int FarmerId, string FarmerName, IReadOnlyList<GoodsEntryDto> Entries, IReadOnlyList<GoodsStockRow> Stock);
