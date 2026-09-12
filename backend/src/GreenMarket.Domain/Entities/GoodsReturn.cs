using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// "مرتجع بضاعة" — goods a buyer sent back off one specific invoice, recorded as its own dated
/// document rather than by editing the invoice.
///
/// Produce spoils: a buyer takes 100 boxes and returns 10 of them the same evening. Before this,
/// the only tools were editing the invoice — which rewrites history as though those goods were
/// never sold — or cancelling the whole thing and re-entering it. Neither leaves a trace of what
/// actually came back, and both burn the audit trail.
///
/// A return moves money on BOTH sides:
///   • the buyer owes less — <see cref="Services.InvoiceCharge"/> subtracts the return total from
///     the invoice's stored GrandTotal;
///   • the seller is due less — they never actually sold those goods, so an offsetting Adjustment
///     is posted to their ledger for the returned value minus the commission that was charged on
///     it (see GoodsReturnService), leaving the market's commission correct on the goods that did
///     sell.
///
/// سعر الخشب is deliberately NOT pro-rated on a return: it's a flat per-line crate charge, not a
/// per-kilo one, and the crates don't come back just because some of what was in them did. If
/// crates are physically returned that's the separate <see cref="ContainerMovement"/> ledger's job.
/// </summary>
public class GoodsReturn : AuditableEntity
{
    public int InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    public DateTimeOffset Date { get; set; }

    /// <summary>Why it came back ("تالف", "غير مطابق") — free text, purely informational.</summary>
    public string? Reason { get; set; }

    /// <summary>
    /// The returned value, summed from <see cref="Items"/> and stored for the same reason
    /// Invoice.GrandTotal is (a balance must never need a per-row subquery to add up).
    /// </summary>
    public decimal TotalValue { get; set; }

    /// <summary>
    /// The invoice's own commission rate at the moment of the return — copied, not looked up, so a
    /// later rate change can't retroactively alter how much of an old return was credited back to
    /// the seller. Same lock-in convention as Invoice.CommissionRateApplied.
    /// </summary>
    public decimal CommissionRateApplied { get; set; }

    public int RecordedByUserId { get; set; }

    public ICollection<GoodsReturnItem> Items { get; set; } = new List<GoodsReturnItem>();
}

/// <summary>
/// One returned line. Deliberately its own item list rather than a pointer at an InvoiceItem row:
/// a buyer can return part of a line, and the invoice's own lines stay exactly as they were
/// entered so the original sale is still readable on the printed copy.
/// </summary>
public class GoodsReturnItem
{
    public int Id { get; set; }

    public int GoodsReturnId { get; set; }
    public GoodsReturn GoodsReturn { get; set; } = null!;

    public string ItemName { get; set; } = string.Empty;

    /// <summary>"العدد" that came back. Mirrors InvoiceItem: always present.</summary>
    public decimal Quantity { get; set; }

    /// <summary>"الوزن" that came back, when the line was sold by weight. Same meaning as
    /// InvoiceItem.WeightKg, and what the credit is computed from when it is set.</summary>
    public decimal? WeightKg { get; set; }

    /// <summary>Crates that came back WITH the produce on this line. Informational here — the
    /// containers ledger nets them off the buyer's balance (see ContainerService); no crate fee is
    /// refunded, matching how سعر الخشب is not pro-rated on a return either.</summary>
    public decimal BoxQuantity { get; set; }

    /// <summary>Cartons that came back with this line. Tracked, never charged.</summary>
    public decimal CartonQuantity { get; set; }

    /// <summary>The price the goods were SOLD at on the invoice — a return is credited back at the
    /// price actually charged, never at today's price.</summary>
    public decimal PricePerUnit { get; set; }

    /// <summary>Priced exactly the way the invoice line was — الوزن × السعر when a weight came
    /// back, otherwise العدد × السعر (InvoiceCalculator.LineTotalFor). Stored, like the invoice's.</summary>
    public decimal LineTotal { get; set; }
}
