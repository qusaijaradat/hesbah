using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>WoodPrice ("سعر الخشب") is optional — a flat per-line add-on picked from a small fixed
/// set of values (3/5/6/7/8), 0 when left unset. Not multiplied by Quantity.</summary>
public record InvoiceItemInput(string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal WoodPrice = 0);

/// <summary>
/// MerchantId/FarmerId/DriverId are optional: if omitted, the matching *Name is used to look up an
/// existing partner by name (case-insensitive) or create a new one on the fly — the market has a
/// different trader/seller/driver most days, so forcing a separate "add partner first" step for
/// every invoice would just get in the way. Exactly one of {Id, Name} must be supplied for each
/// side that's being set at all. FarmerId/DriverId are independent of each other — an invoice can
/// have either, both, or neither. TransportFee ("أجرة النقل") is optional, defaulting to 0.
/// PaidAmount ("المبلغ المدفوع") is optional: when set and greater than 0, InvoiceService records
/// it as a Payment (direction FromMerchant, linked to this invoice) right when the invoice is
/// created — a shortcut for the common "he paid on the spot" case that skips a separate trip to
/// the Payments page. Only honored on CreateAsync, not UpdateAsync (editing an invoice never
/// touches payments — corrections to what's been paid go through the Payments page itself).
/// </summary>
public record CreateInvoiceRequest(
    DateTimeOffset Date,
    int? MerchantId,
    string? MerchantName,
    int? FarmerId,
    string? FarmerName,
    int? DriverId,
    string? DriverName,
    IReadOnlyList<InvoiceItemInput> Items,
    decimal TransportFee = 0,
    decimal? PaidAmount = null);

public record InvoiceItemDto(int Id, string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal WoodPrice, decimal LineTotal);

/// <summary>
/// The merchant-facing view. Deliberately has NO commission field — requirement doc §5:
/// "the market's commission does not appear on the merchant's invoice." GrandTotal =
/// TotalValue + TransportFee + WoodTotal (sum of every item's WoodPrice) — the actual amount the
/// merchant pays, including the pass-through transport/crate costs that are excluded from
/// TotalValue specifically so they never inflate the commission base. PreviousBalance is computed
/// (not stored) in InvoiceService — what this merchant still owed from every one of their OTHER
/// Active invoices, minus every payment they've ever made, clamped to 0 (never shown negative even
/// if they're in credit). Printed on the invoice as "الرصيد السابق" added on top of GrandTotal, so
/// a newly-printed invoice always shows the full amount actually due, not just this one sale.
/// </summary>
public record InvoiceDto(
    int Id, string InvoiceNumber, DateTimeOffset Date,
    int MerchantId, string MerchantName, string? MerchantWhatsApp,
    int? FarmerId, string? FarmerName, string? FarmerWhatsApp,
    int? DriverId, string? DriverName, string? DriverWhatsApp,
    InvoiceStatus Status,
    decimal TotalWeightKg, decimal TotalValue, decimal TransportFee, decimal WoodTotal, decimal GrandTotal,
    decimal PreviousBalance,
    IReadOnlyList<InvoiceItemDto> Items);

/// <summary>
/// MerchantId/MerchantWhatsApp let the bulk-print page group the filtered list by trader
/// identity (not just by display name, which two different partners could share) and offer
/// a per-trader "send via WhatsApp" action without a second round trip just to look those up.
/// FarmerWhatsApp/DriverWhatsApp mirror it for the seller/driver sides, so the plain invoices list
/// can also offer a one-click WhatsApp send per row without navigating into the invoice's detail
/// page first. DriverId mirrors MerchantId for the same reason — grouping by driver identity for
/// the "طباعة كشف السائق" (driver manifest) print, rather than by display name alone, which two
/// different drivers could share. TotalBoxes sits alongside TotalWeightKg because not everything
/// is sold by weight — an invoice made entirely of box-unit items has TotalWeightKg == 0, which on
/// its own looks like a broken/empty invoice in a list view; showing the box count too tells the
/// real story.
/// </summary>
public record InvoiceListItemDto(
    int Id, string InvoiceNumber, DateTimeOffset Date,
    int MerchantId, string MerchantName, string? MerchantWhatsApp,
    string? FarmerName, string? FarmerWhatsApp,
    int? DriverId, string? DriverName, string? DriverWhatsApp,
    InvoiceStatus Status,
    decimal TotalWeightKg, decimal TotalBoxes, decimal TotalValue, decimal TransportFee, decimal GrandTotal);

/// <summary>Requirement doc §7 filters: date range, merchant, farmer/driver, item, user, invoice number, weight, amount.</summary>
public class InvoiceFilterRequest
{
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public int? MerchantId { get; set; }
    public int? FarmerId { get; set; }
    public int? DriverId { get; set; }
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

/// <summary>
/// One row of the bulk-print page's new "كشف بائع" (farmer statement) section — a single item
/// line pulled off one of the farmer's own Active invoices within the picked date range. Date is
/// that owning invoice's date, not a separate per-item date: a farmer can appear across many
/// different invoices within the range, and every one of their item lines becomes its own row
/// here (see InvoiceService.GetFarmerStatementAsync). LineTotal mirrors InvoiceItemDto.LineTotal
/// (Quantity * PricePerUnit only — WoodPrice is a separate flat add-on, same convention as every
/// other item table in this app).
/// </summary>
public record FarmerStatementLineDto(DateTimeOffset Date, string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal WoodPrice, decimal LineTotal);

/// <summary>Wraps the itemized lines above with the farmer's own name, resolved once in
/// InvoiceService so the PDF header can show "البائع: ..." without a second round trip.</summary>
public record FarmerStatementDto(int FarmerId, string FarmerName, IReadOnlyList<FarmerStatementLineDto> Lines);
