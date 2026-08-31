using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// A sale invoice to a merchant (requirement doc §4). The market's commission is
/// deliberately NOT a field here — §5 requires it to stay invisible on the merchant's
/// invoice and out of the merchant's account entirely; it only ever appears on the
/// linked <see cref="FarmerTransaction"/>.
/// </summary>
public class Invoice : AuditableEntity
{
    /// <summary>Human-facing sequential invoice number (e.g. "INV-2026-000123"), distinct from the DB Id.</summary>
    public string InvoiceNumber { get; set; } = string.Empty;

    public DateTimeOffset Date { get; set; }

    public int MerchantId { get; set; }
    public Partner Merchant { get; set; } = null!;

    /// <summary>
    /// Optional: an invoice can be entered for the trader alone. The farmer isn't always known
    /// or relevant at entry time, so it's not required the way the merchant is.
    /// </summary>
    public int? FarmerId { get; set; }
    public Partner? Farmer { get; set; }

    /// <summary>
    /// Optional: the driver who transported this shipment, tracked separately from the seller
    /// (<see cref="Farmer"/>) — an invoice can have either, both, or neither attached. Unlike
    /// Farmer, attaching a driver does NOT create a <see cref="FarmerTransaction"/>/commission
    /// ledger row; the driver's compensation for this invoice is <see cref="TransportFee"/> below.
    /// </summary>
    public int? DriverId { get; set; }
    public Partner? Driver { get; set; }

    public InvoiceStatus Status { get; set; } = InvoiceStatus.Active;

    /// <summary>
    /// Denormalized totals, recomputed by <see cref="Services.InvoiceCalculator"/> whenever items
    /// change. TotalWeightKg only sums lines whose <see cref="InvoiceItem.Unit"/> is Kg — a box-based
    /// line has no kg weight to contribute, so it's simply excluded from this figure rather than
    /// mixed into it. TotalValue always includes every line regardless of unit.
    /// </summary>
    public decimal TotalWeightKg { get; set; }
    public decimal TotalValue { get; set; }

    /// <summary>Commission rate actually applied (copied from Settings at creation time so later rate changes don't retroactively alter old invoices).</summary>
    public decimal CommissionRateApplied { get; set; }

    /// <summary>
    /// Optional flat transport/delivery fee for this invoice ("أجرة النقل"), defaulting to 0.
    /// Deliberately kept OUT of <see cref="TotalValue"/> so it never inflates the commission base
    /// (commission is always computed off the product value alone) — it's added back in only for
    /// the merchant-facing grand total (see InvoiceDto.GrandTotal).
    /// </summary>
    public decimal TransportFee { get; set; }

    public int? CancelledByUserId { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancellationReason { get; set; }

    public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();
    public FarmerTransaction? FarmerTransaction { get; set; }
}
