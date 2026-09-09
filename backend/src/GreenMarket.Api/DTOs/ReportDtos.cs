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
/// - TotalCommission - TotalTransportFee, exactly what FarmerTransaction.Amount carries on their
/// own ledger (InvoiceCharge.ForSeller). No wood: "سعر الخشب" is the MARKET's, so it is no part
/// of what is owed to this seller. أجرة النقل is
/// deducted: it is what it cost to bring the produce in — this is what the market owes them BEFORE
/// payments/adjustments, kept alongside Remaining (which nets in OpeningBalance,
/// every payment, and any Adjustment reversal) so both "how much did we owe from sales alone" and
/// "how much is left right now" are visible at once. OpeningBalance is broken out on its own even
/// though it's already folded into Remaining — same traceability convention as
/// MerchantAccountDto/FarmerAccountDto. LastInvoiceDate is null only if InvoiceCount is 0, which
/// can't happen here (a farmer only appears in this report at all because they have at least one
/// matching invoice).
/// </summary>
public record FarmerReportRow(
    int FarmerId, string FarmerName,
    int InvoiceCount, decimal TotalWeightKg, decimal TotalBoxes, decimal TotalSalesValue,
    decimal TotalCommission, decimal NetDue, decimal TotalPaid, decimal Remaining,
    decimal OpeningBalance, DateTimeOffset? LastInvoiceDate);

/// <summary>
/// Requirement doc §8: merchant (مشتري) report — detailed per-buyer breakdown. TotalPurchases
/// mirrors InvoiceDto.TotalValue (product value only, commission base — never includes wood or
/// crate fees). TotalWoodTotal/TotalBoxFee are broken out on their own (never silently folded into
/// TotalPurchases) so both stay visible in detail. أجرة النقل is NOT here at all: it comes off the
/// seller and goes to the driver, so a buyer is never charged for it. GrandTotal is the SUM of each matching
/// invoice's own stored charge (see InvoiceCharge). TotalBoxFee is broken out beside the other
/// two so the row adds up on screen: purchases + wood + transport + box fee = GrandTotal, except
/// on invoices carrying a مرتجع, which GrandTotal is net of.
/// It is deliberately read rather than re-derived from those three: this row's Remaining already
/// sums the same stored charge, and a total assembled a second way is a total that eventually
/// disagrees with it.
/// OpeningBalance is broken out even though it's already folded into Remaining, same traceability
/// convention as MerchantAccountDto.
/// </summary>
public record MerchantReportRow(
    int MerchantId, string MerchantName,
    int InvoiceCount, decimal TotalWeightKg, decimal TotalBoxes,
    decimal TotalPurchases, decimal TotalWoodTotal, decimal TotalBoxFee, decimal GrandTotal,
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

/// <summary>
/// "طباعة الفواتير" → قسم البائع's "كشف بائع حسب الفترة" — same per-item breakdown idea as
/// MerchantItemBreakdownRow, one row per (farmer, item) instead of one row per farmer, scoped to
/// whichever period that tab's own filter is already set to. TotalValue is that item's own gross
/// LineTotal (Quantity × PricePerUnit) summed across every matching invoice — the same "raw sale
/// value" convention as MerchantItemBreakdownRow.TotalValue, NOT the farmer's net-after-commission
/// figure (see FarmerReportRow.NetDue for that number).
/// </summary>
public record FarmerItemBreakdownRow(
    int FarmerId, string FarmerName, string ItemName, UnitOfMeasure Unit,
    decimal TotalQuantity, decimal TotalValue);

/// <summary>
/// "طباعة الفواتير" → قسم السائق's "كشف سائق حسب الفترة" — one row per (driver, item) carried
/// during the period. Unlike Merchant/FarmerItemBreakdownRow there is deliberately NO per-item price
/// here — a driver earns a flat أجرة نقل per INVOICE, never a price per item, so attributing a value
/// to "this many kg of tomatoes" would be meaningless. TotalTransportFee is instead this driver's
/// total transport fee for the WHOLE period (summed once per invoice, matching every other
/// invoice-level TransportFee total in this app) — the SAME number is repeated across every one of
/// that driver's item rows purely so this can stay one flat list of rows; a caller must read it once
/// per driver (e.g. from that driver's first row), never sum it across rows, or it will be counted
/// once per item instead of once per invoice.
/// </summary>
public record DriverItemBreakdownRow(
    int DriverId, string DriverName, string ItemName, UnitOfMeasure Unit,
    decimal TotalQuantity, decimal TotalTransportFee);

/// <summary>
/// Requirement doc §8: market reports — daily/monthly profits/commissions, or a specified period.
///
/// NetProfit is everything the market keeps, not just commission minus expenses (see
/// MarketEarnings for the derivation): commission, plus the crate fee charged to buyers, minus
/// the crate handling paid to drivers, plus transport/wood on any invoice that has no driver to
/// pay them to, minus the commission handed back on goods returned, minus expenses. The four
/// middle terms are broken out on their own rather than folded into the total — same "never let
/// a figure disappear silently into a total" convention as the invoice DTOs.
/// </summary>
public record MarketReportRow(
    string Period, decimal TotalSalesValue, decimal TotalCommission,
    decimal BoxFeeIncome, decimal WoodIncome, decimal DriverBoxFeeCost, decimal KeptPassThrough, decimal ReturnsCommissionCredit,
    decimal TotalExpenses, decimal NetProfit);

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
/// End-of-day summary for closing out the market's books for a single date.
///
/// NetProfit is the accounting figure — what the day earned, whether or not it has been
/// collected yet — and it is everything the market keeps, not just commission minus expenses:
/// see MarketEarnings for the derivation. It used to be exactly "commission − expenses", which
/// left the crate margin out of the day's profit entirely; on a forty-box invoice that is more
/// money than it sounds, and over a day of them it was the difference between a real number and
/// a rough one. The four middle terms are broken out rather than folded in, so the total can be
/// read back to its parts.
///
/// PaymentsReceivedFromMerchants/PaymentsPaidToFarmers are the day's actual cash movements — a
/// separate, equally important number for someone physically closing a cash drawer.
/// </summary>
public record DailyClosingDto(
    DateTimeOffset Date,
    int InvoiceCount,
    decimal TotalSalesValue,
    decimal TotalCommission,
    /// <summary>رسوم الصناديق charged to buyers on the day's invoices — the market keeps this.</summary>
    decimal BoxFeeIncome,
    /// <summary>سعر الخشب charged to buyers — the market keeps this too; neither the seller nor
    /// the driver has a claim on it.</summary>
    decimal WoodIncome,
    /// <summary>أجرة الصناديق paid out to drivers on those same invoices — a real cost.</summary>
    decimal DriverBoxFeeCost,
    /// <summary>أجرة النقل taken off the seller on invoices with NO driver attached, so there was
    /// nobody to pass it to. Normally zero; a non-zero figure here is usually a driver missing from
    /// an invoice, which is worth seeing as money rather than losing silently.</summary>
    decimal KeptPassThrough,
    /// <summary>Commission handed back on goods returned on this date.</summary>
    decimal ReturnsCommissionCredit,
    decimal TotalExpenses,
    decimal NetProfit,
    decimal PaymentsReceivedFromMerchants,
    decimal PaymentsPaidToFarmers);

/// <summary>
/// Everything the دashboard needs to answer "how do we stand right now", in ONE request.
///
/// The screen it replaces showed three numbers about today and nothing else — the market's real
/// money picture (who owes us, what we owe, which checks are about to land, what's still unpaid or
/// unpriced) lived scattered across five other pages, so nobody saw it unless they went looking.
///
/// Two different clocks on purpose: the "اليوم" figures are today's activity, while every balance
/// and count below is the CURRENT position, all-time — a debt from last month is still a debt this
/// morning. Mixing the two into one date-scoped payload is what would make this misleading.
/// </summary>
public record DashboardSummaryDto(
    // Today.
    int TodayInvoiceCount,
    decimal TodaySalesValue,
    decimal TodayCommission,
    decimal TodayCashIn,
    decimal TodayCashOut,

    // Current position. MerchantsOwe is what buyers still owe the market; OwedToSellers is what the
    // market still owes sellers and drivers (their ledgers share one table — see FarmerTransaction).
    decimal MerchantsOwe,
    decimal OwedToSellers,

    // Checks still قيد التحصيل, split by how urgent they are. Overdue is "due date already passed",
    // which is the one that costs money to miss.
    int ChecksDueTodayCount, decimal ChecksDueTodayAmount,
    int ChecksOverdueCount, decimal ChecksOverdueAmount,
    int ChecksDueSoonCount, decimal ChecksDueSoonAmount,

    // Work still outstanding on invoices — the same two states the invoices list can now filter by.
    int UnpaidInvoiceCount, decimal UnpaidInvoiceAmount,
    int UnpricedInvoiceCount,

    // Who to chase first. Biggest debts, largest first, capped — a dashboard is a starting point,
    // not the قيمة الديون page.
    IReadOnlyList<PartnerDebtRow> TopMerchantDebts,
    IReadOnlyList<PartnerDebtRow> TopSellerDues);
