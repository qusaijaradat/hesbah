using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>One "إضافة بضاعة" intake record, as shown/edited on the "بضاعة الباعة" page.
/// WoodQuantity is a physical count of wooden crates used to carry this delivery — a field
/// entirely independent of Quantity/Unit (a farmer can bring 50 كغم of tomatoes using 3 wooden
/// crates; "3" is a crate count, not "3 كغم"), so it's always a plain count regardless of whether
/// Unit is Kg or Box, and is never validated against or displayed using Quantity/Unit — see
/// GoodsService.ValidateLine and FarmerGoodsPage.tsx.</summary>
public record GoodsEntryDto(
    int Id, int FarmerId, string FarmerName, DateTimeOffset Date,
    string ItemName, UnitOfMeasure Unit, decimal Quantity, decimal WoodQuantity, string? Notes);

/// <summary>FarmerId is required — unlike an invoice, a goods intake entry is always logged
/// against an already-known farmer (the page's own farmer picker doesn't allow typing a brand
/// new name), so there's no FarmerName find-or-create fallback here.</summary>
public record CreateGoodsEntryRequest(
    int FarmerId, DateTimeOffset Date, string ItemName, UnitOfMeasure Unit,
    decimal Quantity, decimal WoodQuantity = 0, string? Notes = null);

public record UpdateGoodsEntryRequest(
    DateTimeOffset Date, string ItemName, UnitOfMeasure Unit,
    decimal Quantity, decimal WoodQuantity = 0, string? Notes = null);

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
/// count regardless of this row's own Unit (Kg or Box). It is never netted against TotalSold —
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
public record GoodsStockRow(string ItemName, UnitOfMeasure Unit, decimal TotalReceived, decimal TotalSold, decimal Available, decimal WoodReceived, int? FarmerId = null, string? FarmerName = null);

/// <summary>Wraps a farmer's own name with both halves of the "بضاعة الباعة" page: the raw intake
/// log (Entries, newest first — editable/deletable) and the computed per-item stock summary
/// (Stock) that nets those entries against actual sales.</summary>
public record FarmerGoodsStockDto(int FarmerId, string FarmerName, IReadOnlyList<GoodsEntryDto> Entries, IReadOnlyList<GoodsStockRow> Stock);
