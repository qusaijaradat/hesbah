using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// A recorded cash movement (requirement doc §6): either a merchant paying down their
/// invoice balance, or the market paying a farmer their net due.
/// </summary>
public class Payment : AuditableEntity
{
    public int PartnerId { get; set; }
    public Partner Partner { get; set; } = null!;

    public PaymentDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public DateTimeOffset Date { get; set; }
    public string? Method { get; set; }
    public string? Notes { get; set; }

    public int RecordedByUserId { get; set; }

    /// <summary>
    /// Optional link to the specific invoice this payment settles (roadmap: "link a payment to a
    /// specific invoice rather than only an aggregate partner balance"). Null keeps the previous
    /// behaviour — the payment just reduces the partner's overall balance, which is still the
    /// right choice when someone is paying off several invoices at once rather than one in
    /// particular. When set, the invoice must belong to the same partner as the payment.
    /// </summary>
    public int? InvoiceId { get; set; }
    public Invoice? Invoice { get; set; }
}
