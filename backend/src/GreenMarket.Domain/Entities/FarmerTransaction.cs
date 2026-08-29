using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// The farmer-and-market-only internal ledger line (requirement doc §5/§6). One row per
/// invoice (Sale type) plus one row per payment made to the farmer (Payment type).
/// This is where the commission actually lives — it is never exposed on the merchant side.
/// </summary>
public class FarmerTransaction
{
    public int Id { get; set; }

    public int FarmerId { get; set; }
    public Partner Farmer { get; set; } = null!;

    public FarmerTransactionType Type { get; set; }

    /// <summary>Null for Payment-type rows.</summary>
    public int? InvoiceId { get; set; }
    public Invoice? Invoice { get; set; }

    /// <summary>Null for Sale-type rows.</summary>
    public int? PaymentId { get; set; }
    public Payment? Payment { get; set; }

    public DateTimeOffset Date { get; set; }

    /// <summary>Sale value before commission (Sale rows only; 0 for Payment/Adjustment rows).</summary>
    public decimal SaleValue { get; set; }

    /// <summary>Market's commission on this sale (Sale rows only).</summary>
    public decimal Commission { get; set; }

    /// <summary>
    /// Signed ledger amount: +NetDue for a Sale (increases what the market owes the farmer),
    /// -Amount for a Payment (reduces it). Running balance = SUM(this column) ordered by date.
    /// </summary>
    public decimal Amount { get; set; }

    public string? Notes { get; set; }
}
