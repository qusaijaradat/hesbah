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

    /// <summary>
    /// Set only when this payment is a check ("شيك") — its due/maturity date ("تاريخ الاستحقاق").
    /// Null for cash/transfer/other methods. This field (not the free-text <see cref="Method"/>
    /// string) is what the Checks page and ListChecksAsync use to find "is this payment a check" —
    /// lets a single invoice be settled with several methods at once (e.g. part cash, part checks)
    /// simply by recording several Payment rows against it, one per method.
    /// </summary>
    public DateTimeOffset? CheckDueDate { get; set; }

    /// <summary>Optional check number written on the physical check, for matching against the bank record.</summary>
    public string? CheckNumber { get; set; }

    /// <summary>Only meaningful when <see cref="CheckDueDate"/> is set — defaults to Pending at creation.</summary>
    public CheckClearanceStatus? CheckStatus { get; set; }

    /// <summary>The date the check was ACTUALLY cashed/deposited — only ever set while
    /// <see cref="CheckStatus"/> is Cleared, and cleared back to null the moment it isn't (see
    /// PaymentService.UpdateAsync). Distinct from <see cref="CheckDueDate"/>: a check can clear
    /// before or after its nominal due date, and reconciling against the bank statement needs the
    /// real date, not the expected one.</summary>
    public DateTimeOffset? CheckClearedDate { get; set; }
}
