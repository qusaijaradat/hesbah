using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>One "إضافة بضاعة" intake record, as shown/edited on the "بضاعة الباعة" page.</summary>
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
/// </summary>
public record GoodsStockRow(string ItemName, UnitOfMeasure Unit, decimal TotalReceived, decimal TotalSold, decimal Available);

/// <summary>Wraps a farmer's own name with both halves of the "بضاعة الباعة" page: the raw intake
/// log (Entries, newest first — editable/deletable) and the computed per-item stock summary
/// (Stock) that nets those entries against actual sales.</summary>
public record FarmerGoodsStockDto(int FarmerId, string FarmerName, IReadOnlyList<GoodsEntryDto> Entries, IReadOnlyList<GoodsStockRow> Stock);
