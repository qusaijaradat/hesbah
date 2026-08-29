using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

public record InvoiceItemInput(string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit);

/// <summary>
/// MerchantId/FarmerId are optional: if omitted, MerchantName/FarmerName is used to look up an
/// existing partner by name (case-insensitive) or create a new one on the fly — the market has a
/// different trader/farmer most days, so forcing a separate "add partner first" step for every
/// invoice would just get in the way. Exactly one of {Id, Name} must be supplied for each side.
/// </summary>
public record CreateInvoiceRequest(
    DateTimeOffset Date,
    int? MerchantId,
    string? MerchantName,
    int? FarmerId,
    string? FarmerName,
    IReadOnlyList<InvoiceItemInput> Items);

public record InvoiceItemDto(int Id, string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal LineTotal);

/// <summary>
/// The merchant-facing view. Deliberately has NO commission field — requirement doc §5:
/// "the market's commission does not appear on the merchant's invoice."
/// </summary>
public record InvoiceDto(
    int Id, string InvoiceNumber, DateTimeOffset Date,
    int MerchantId, string MerchantName, string? MerchantWhatsApp,
    int? FarmerId, string? FarmerName, string? FarmerWhatsApp,
    InvoiceStatus Status,
    decimal TotalWeightKg, decimal TotalValue,
    IReadOnlyList<InvoiceItemDto> Items);

/// <summary>
/// MerchantId/MerchantWhatsApp let the bulk-print page group the filtered list by trader
/// identity (not just by display name, which two different partners could share) and offer
/// a per-trader "send via WhatsApp" action without a second round trip just to look those up.
/// FarmerWhatsApp mirrors it for the farmer side, so the plain invoices list can also offer a
/// one-click WhatsApp send per row without navigating into the invoice's detail page first.
/// TotalBoxes sits alongside TotalWeightKg because not everything is sold by weight — an
/// invoice made entirely of box-unit items has TotalWeightKg == 0, which on its own looks like
/// a broken/empty invoice in a list view; showing the box count too tells the real story.
/// </summary>
public record InvoiceListItemDto(
    int Id, string InvoiceNumber, DateTimeOffset Date,
    int MerchantId, string MerchantName, string? MerchantWhatsApp,
    string? FarmerName, string? FarmerWhatsApp, InvoiceStatus Status,
    decimal TotalWeightKg, decimal TotalBoxes, decimal TotalValue);

/// <summary>Requirement doc §7 filters: date range, merchant, farmer, item, user, invoice number, weight, amount.</summary>
public class InvoiceFilterRequest
{
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public int? MerchantId { get; set; }
    public int? FarmerId { get; set; }
    public string? ItemName { get; set; }
    public int? CreatedByUserId { get; set; }
    public string? InvoiceNumber { get; set; }

    /// <summary>Bulk-print page (requirement: "print invoices from # to #") — an inclusive range on
    /// InvoiceNumber. Compared as plain strings: since invoice numbers are zero-padded within a
    /// year (INV-2026-000123), string order matches numeric order as long as both bounds share a
    /// year; a range spanning a year boundary is a rare enough edge case not worth the extra complexity.</summary>
    public string? InvoiceNumberFrom { get; set; }
    public string? InvoiceNumberTo { get; set; }

    public decimal? MinWeightKg { get; set; }
    public decimal? MaxWeightKg { get; set; }
    public decimal? MinAmount { get; set; }
    public decimal? MaxAmount { get; set; }
    public InvoiceStatus? Status { get; set; }

    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
}

public record CancelInvoiceRequest(string Reason);
