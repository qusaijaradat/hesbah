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
    /// (<see cref="Farmer"/>) — an invoice can have either, both, or neither attached. If both are
    /// attached AND TransportFee is greater than 0, this invoice ends up with TWO rows in
    /// <see cref="FarmerTransactions"/>: a Sale row keyed to the farmer, and a TransportFee row
    /// keyed to the driver (see FarmerTransactionType.TransportFee) — the driver's compensation
    /// for this invoice is <see cref="TransportFee"/> below, never folded into commission math.
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

    /// <summary>
    /// Box-price ("سعر الصندوق") actually applied — copied from Settings.Keys.BoxPrice at creation
    /// time, same lock-in convention as <see cref="CommissionRateApplied"/>, so a later change to
    /// the settings value never retroactively alters an already-issued invoice. The actual fee
    /// charged (BoxFeeTotal = box-unit item count × this rate) is NOT stored — it's computed on
    /// read (InvoiceService.ToDto), same as WoodTotal, since the box count itself is always
    /// re-derivable from Items. Completely separate from/additive to the existing manual per-line
    /// WoodPrice — both can apply to the same invoice at once (explicit request). Kept OUT of
    /// TotalValue for the same commission-base reason as TransportFee above; added back in only
    /// for the merchant-facing grand total.
    /// </summary>
    public decimal BoxPriceApplied { get; set; }

    /// <summary>
    /// Driver-side per-box handling fee ("أجرة الصناديق") actually applied — copied from
    /// Settings.Keys.DriverBoxFee at creation time, same lock-in convention as
    /// <see cref="BoxPriceApplied"/>/<see cref="CommissionRateApplied"/>. Unlike BoxPriceApplied
    /// (charged to the merchant), this is money owed TO the driver, on top of the manual
    /// <see cref="TransportFee"/> — the actual fee (box-unit item count × this rate) is NOT
    /// stored, computed fresh on read (InvoiceService.ToDto) same as BoxFeeTotal, and is folded
    /// into the driver's own FarmerTransaction (Type = TransportFee) Amount so it flows through
    /// the driver's account/statement/reports exactly like the rest of their transport earnings.
    /// Deliberately kept OUT of both TotalValue (commission base) and the merchant-facing
    /// GrandTotal — it is purely an internal market→driver cost, invisible to the merchant.
    /// </summary>
    public decimal DriverBoxFeeApplied { get; set; }

    /// <summary>
    /// "خصم" — a flat concession given to the buyer on this invoice (haggling, a goodwill
    /// reduction, a rounding-down). Comes off the merchant's grand total and nothing else: it is
    /// the MARKET's concession out of its own commission, so it never reduces TotalValue (the
    /// commission base) and never reduces what the farmer or driver is paid. Same "kept out of the
    /// commission base" treatment as TransportFee/BoxPriceApplied, just in the other direction.
    /// </summary>
    public decimal Discount { get; set; }

    /// <summary>
    /// What this invoice actually charges the merchant, STORED rather than derived:
    /// TotalValue + TransportFee + wood total + box-fee total − Discount − returns total.
    /// Recomputed by <see cref="Services.InvoiceCharge"/> whenever items, fees, the discount or
    /// this invoice's returns change.
    ///
    /// This deliberately breaks the "computed fresh on read, never stored" convention that
    /// WoodTotal/BoxFeeTotal follow, and it's worth saying why: those are only ever needed for ONE
    /// invoice whose Items are already loaded. The merchant's BALANCE, though, is a sum across
    /// every invoice they've ever had — and deriving it per row means a correlated subquery over
    /// InvoiceItems for each one. That cost is exactly why four separate balance queries
    /// (PartnerService's list/account/debts and ReportService's merchant report) quietly summed
    /// TotalValue alone instead, leaving the wood, transport and box charges out of every balance
    /// in the app while the printed invoice's own "الرصيد السابق" included them — the same merchant
    /// showing two different debts depending on the screen. One stored column removes that whole
    /// class of drift: every balance is now SUM(GrandTotal), and there is one place that decides
    /// what an invoice charges.
    /// </summary>
    public decimal GrandTotal { get; set; }

    public int? CancelledByUserId { get; set; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancellationReason { get; set; }

    public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();

    /// <summary>
    /// Up to two rows: a Sale row for the farmer (if attached) and/or a TransportFee row for the
    /// driver (if attached and TransportFee &gt; 0) — was a single nullable one-to-one reference
    /// before drivers got their own ledger entries; now a plain collection since an invoice can
    /// legitimately have both at once.
    /// </summary>
    public ICollection<FarmerTransaction> FarmerTransactions { get; set; } = new List<FarmerTransaction>();

    /// <summary>"مرتجع بضاعة" documents raised against this invoice — see GoodsReturn.</summary>
    public ICollection<GoodsReturn> Returns { get; set; } = new List<GoodsReturn>();

    /// <summary>Payments settling THIS invoice specifically (Payment.InvoiceId). A navigation
    /// rather than a loose query so "how much of this invoice is paid" can be asked inside a
    /// translated LINQ predicate — that's what backs the مدفوعة/جزئياً/غير مدفوعة filter.</summary>
    public ICollection<Payment> Payments { get; set; } = new List<Payment>();
}
