using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

public class ReportFilterRequest
{
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public int? PartnerId { get; set; }
    public string? Grouping { get; set; } // "daily" | "monthly" | null (whole period) — requirement doc §8
}

/// <summary>
/// Requirement doc §8: farmer (بائع) report — detailed per-seller breakdown, not just a single
/// totals line. TotalBoxes sits alongside TotalWeightKg for the same reason InvoiceListItemDto's
/// does (a box-only seller would otherwise show 0 weight and look empty). NetDue = TotalSalesValue
/// - TotalCommission — what the market owes this farmer BEFORE payments/adjustments, kept
/// alongside Remaining (which nets in OpeningBalance, every payment, and any Adjustment reversal)
/// so both "how much did we owe from sales alone" and "how much is left right now" are visible at
/// once. OpeningBalance is broken out on its own even though it's already folded into Remaining —
/// same traceability convention as MerchantAccountDto/FarmerAccountDto. LastInvoiceDate is null
/// only if InvoiceCount is 0, which can't happen here (a farmer only appears in this report at all
/// because they have at least one matching invoice).
/// </summary>
public record FarmerReportRow(
    int FarmerId, string FarmerName,
    int InvoiceCount, decimal TotalWeightKg, decimal TotalBoxes, decimal TotalSalesValue,
    decimal TotalCommission, decimal NetDue, decimal TotalPaid, decimal Remaining,
    decimal OpeningBalance, DateTimeOffset? LastInvoiceDate);

/// <summary>
/// Requirement doc §8: merchant (مشتري) report — detailed per-buyer breakdown. TotalPurchases
/// mirrors InvoiceDto.TotalValue (product value only, commission base — never includes wood/
/// transport). TotalWoodTotal/TotalTransportFee are broken out on their own (never silently folded
/// into TotalPurchases) so "سعر الخشب" and "أجرة النقل" stay visible in detail, matching the same
/// convention used on the invoice list / bulk-print pages. GrandTotal = TotalPurchases +
/// TotalWoodTotal + TotalTransportFee — the actual amount charged across every matching invoice.
/// OpeningBalance is broken out even though it's already folded into Remaining, same traceability
/// convention as MerchantAccountDto.
/// </summary>
public record MerchantReportRow(
    int MerchantId, string MerchantName,
    int InvoiceCount, decimal TotalWeightKg, decimal TotalBoxes,
    decimal TotalPurchases, decimal TotalWoodTotal, decimal TotalTransportFee, decimal GrandTotal,
    decimal TotalPaid, decimal Remaining, decimal OpeningBalance, DateTimeOffset? LastInvoiceDate);

/// <summary>
/// Requirement doc §8: driver (سائق) report — the counterpart to FarmerReportRow for the transport
/// side of the ledger. A driver never has a "sale"/commission of their own (see
/// FarmerTransactionType.TransportFee's doc comment) — TotalTransportFee is everything they've
/// earned for transporting shipments across every matching invoice, TotalPaid/Remaining/
/// OpeningBalance follow the exact same convention as FarmerReportRow (same shared
/// farmer_transactions ledger, same Remaining formula). Previously a pure driver never appeared in
/// ANY report at all (the old combined "تقرير الباعة والسواق" only ever looked at Invoice.FarmerId) —
/// this is that gap closed with its own dedicated, fully detailed report instead of folding drivers
/// into the farmer report where they don't really belong (no sales value/commission to show).
/// </summary>
public record DriverReportRow(
    int DriverId, string DriverName,
    int InvoiceCount, decimal TotalTransportFee, decimal TotalPaid, decimal Remaining,
    decimal OpeningBalance, DateTimeOffset? LastInvoiceDate);

/// <summary>
/// Dashboard "كشف المشترين حسب الفترة" — one row per (merchant, item) instead of one row per
/// merchant, so the period statement shows exactly what each merchant bought, not just how much
/// they owe in total. TotalQuantity is that item's quantity in ITS OWN unit (Kg or Box — never mix
/// the two into one number, same rule as FarmerGoodsRow); TotalValue is the sum of that item's own
/// LineTotal (Quantity × PricePerUnit) across every matching invoice — WoodPrice is deliberately
/// excluded, same convention as every other per-item total in this app (it's a flat per-line add-on,
/// not a per-item price component).
/// </summary>
public record MerchantItemBreakdownRow(
    int MerchantId, string MerchantName, string ItemName, UnitOfMeasure Unit,
    decimal TotalQuantity, decimal TotalValue);

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
