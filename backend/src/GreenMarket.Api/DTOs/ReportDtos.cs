namespace GreenMarket.Api.DTOs;

public class ReportFilterRequest
{
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public int? PartnerId { get; set; }
    public string? Grouping { get; set; } // "daily" | "monthly" | null (whole period) — requirement doc §8
}

/// <summary>Requirement doc §8: farmer reports — invoices, total kg, total sales, commission, paid, remaining.</summary>
public record FarmerReportRow(
    int FarmerId, string FarmerName,
    int InvoiceCount, decimal TotalWeightKg, decimal TotalSalesValue,
    decimal TotalCommission, decimal TotalPaid, decimal Remaining);

/// <summary>Requirement doc §8: merchant reports — purchases, invoices, paid, remaining.</summary>
public record MerchantReportRow(
    int MerchantId, string MerchantName,
    int InvoiceCount, decimal TotalPurchases, decimal TotalPaid, decimal Remaining);

/// <summary>Requirement doc §8: market reports — daily/monthly profits/commissions, or a specified period.</summary>
public record MarketReportRow(
    string Period, decimal TotalSalesValue, decimal TotalCommission, decimal TotalExpenses, decimal NetProfit);

/// <summary>
/// Roadmap feature: outstanding merchant balances bucketed by how long they've been owed —
/// "متابعة التحصيل" (collection follow-up). Only merchants with a positive outstanding balance
/// (Total > 0) are included. Buckets are computed by allocating payments against a merchant's
/// invoices oldest-first (FIFO), except where a payment is explicitly linked to one invoice (see
/// Payment.InvoiceId) — that amount is applied to that invoice specifically before the FIFO pass.
/// </summary>
public record AgingReportRow(
    int MerchantId, string MerchantName,
    decimal Current, decimal Days30To59, decimal Days60To89, decimal Days90Plus, decimal Total);

/// <summary>
/// End-of-day summary for closing out the market's books for a single date. NetProfit is the
/// accounting figure (commission earned minus expenses, regardless of what's actually been
/// collected yet). PaymentsReceivedFromMerchants/PaymentsPaidToFarmers are the day's actual cash
/// movements — a separate, equally important number for someone physically closing a cash drawer.
/// </summary>
public record DailyClosingDto(
    DateTimeOffset Date,
    int InvoiceCount,
    decimal TotalSalesValue,
    decimal TotalCommission,
    decimal TotalExpenses,
    decimal NetProfit,
    decimal PaymentsReceivedFromMerchants,
    decimal PaymentsPaidToFarmers);
