using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §8: farmer / merchant / market reports, all filterable, printable, exportable.</summary>
public interface IReportService
{
    Task<IReadOnlyList<FarmerReportRow>> FarmerReportAsync(ReportFilterRequest filter);
    Task<IReadOnlyList<MerchantReportRow>> MerchantReportAsync(ReportFilterRequest filter);
    Task<IReadOnlyList<MarketReportRow>> MarketReportAsync(ReportFilterRequest filter);
    Task<DailyClosingDto> DailyClosingAsync(DateTimeOffset date);
    Task<IReadOnlyList<AgingReportRow>> AgingReportAsync(ReportFilterRequest filter);
}

public class ReportService : IReportService
{
    private readonly AppDbContext _db;
    public ReportService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<FarmerReportRow>> FarmerReportAsync(ReportFilterRequest filter)
    {
        // Farmer is optional on an invoice (an invoice can be for the trader alone) — those
        // rows have nothing to attribute to a farmer, so they're simply excluded here.
        var invoiceQuery = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active && i.FarmerId != null);
        if (filter.DateFrom is not null) invoiceQuery = invoiceQuery.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) invoiceQuery = invoiceQuery.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) invoiceQuery = invoiceQuery.Where(i => i.FarmerId == filter.PartnerId);

        var invoiceAgg = await invoiceQuery
            .GroupBy(i => new { FarmerId = i.FarmerId!.Value, i.Farmer!.Name })
            .Select(g => new
            {
                FarmerId = g.Key.FarmerId,
                FarmerName = g.Key.Name,
                InvoiceCount = g.Count(),
                TotalWeightKg = g.Sum(i => i.TotalWeightKg),
                TotalSalesValue = g.Sum(i => i.TotalValue)
            })
            .ToListAsync();

        var commissionQuery = _db.FarmerTransactions.Where(t => t.Type == FarmerTransactionType.Sale);
        if (filter.DateFrom is not null) commissionQuery = commissionQuery.Where(t => t.Date >= filter.DateFrom);
        if (filter.DateTo is not null) commissionQuery = commissionQuery.Where(t => t.Date <= filter.DateTo);
        if (filter.PartnerId is not null) commissionQuery = commissionQuery.Where(t => t.FarmerId == filter.PartnerId);
        var commissionByFarmer = await commissionQuery.GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Commission = g.Sum(t => t.Commission) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Commission);

        var paidQuery = _db.FarmerTransactions.Where(t => t.Type == FarmerTransactionType.Payment);
        if (filter.DateFrom is not null) paidQuery = paidQuery.Where(t => t.Date >= filter.DateFrom);
        if (filter.DateTo is not null) paidQuery = paidQuery.Where(t => t.Date <= filter.DateTo);
        if (filter.PartnerId is not null) paidQuery = paidQuery.Where(t => t.FarmerId == filter.PartnerId);
        var paidByFarmer = await paidQuery.GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Paid = g.Sum(t => -t.Amount) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Paid);

        // "Remaining" is the all-time running balance (not scoped to the filter window) so it
        // always reflects reality, matching how the account statement screen computes it.
        // Note: "== null" here, not "is null" — pattern-matching ('is') can't appear inside
        // a lambda EF Core converts to an expression tree; plain equality can.
        var allTimeBalance = await _db.FarmerTransactions
            .Where(t => filter.PartnerId == null || t.FarmerId == filter.PartnerId)
            .GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Balance = g.Sum(t => t.Amount) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Balance);

        return invoiceAgg.Select(a => new FarmerReportRow(
            a.FarmerId, a.FarmerName, a.InvoiceCount, a.TotalWeightKg, a.TotalSalesValue,
            commissionByFarmer.GetValueOrDefault(a.FarmerId), paidByFarmer.GetValueOrDefault(a.FarmerId),
            allTimeBalance.GetValueOrDefault(a.FarmerId)))
            .OrderBy(r => r.FarmerName)
            .ToList();
    }

    public async Task<IReadOnlyList<MerchantReportRow>> MerchantReportAsync(ReportFilterRequest filter)
    {
        var invoiceQuery = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active);
        if (filter.DateFrom is not null) invoiceQuery = invoiceQuery.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) invoiceQuery = invoiceQuery.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) invoiceQuery = invoiceQuery.Where(i => i.MerchantId == filter.PartnerId);

        var invoiceAgg = await invoiceQuery
            .GroupBy(i => new { i.MerchantId, i.Merchant.Name })
            .Select(g => new
            {
                MerchantId = g.Key.MerchantId,
                MerchantName = g.Key.Name,
                InvoiceCount = g.Count(),
                TotalPurchases = g.Sum(i => i.TotalValue)
            })
            .ToListAsync();

        // Note: "== null" here, not "is null" — same expression-tree restriction as above.
        var allTimePurchases = await _db.Invoices.Where(i => i.Status == InvoiceStatus.Active)
            .Where(i => filter.PartnerId == null || i.MerchantId == filter.PartnerId)
            .GroupBy(i => i.MerchantId)
            .Select(g => new { MerchantId = g.Key, Total = g.Sum(i => i.TotalValue) })
            .ToDictionaryAsync(x => x.MerchantId, x => x.Total);

        var allTimePaid = await _db.Payments.Where(p => p.Direction == PaymentDirection.FromMerchant)
            .Where(p => filter.PartnerId == null || p.PartnerId == filter.PartnerId)
            .GroupBy(p => p.PartnerId)
            .Select(g => new { MerchantId = g.Key, Total = g.Sum(p => p.Amount) })
            .ToDictionaryAsync(x => x.MerchantId, x => x.Total);

        return invoiceAgg.Select(a =>
        {
            var totalPaid = allTimePaid.GetValueOrDefault(a.MerchantId);
            var remaining = allTimePurchases.GetValueOrDefault(a.MerchantId) - totalPaid;
            return new MerchantReportRow(a.MerchantId, a.MerchantName, a.InvoiceCount, a.TotalPurchases, totalPaid, remaining);
        })
        .OrderBy(r => r.MerchantName)
        .ToList();
    }

    public async Task<IReadOnlyList<MarketReportRow>> MarketReportAsync(ReportFilterRequest filter)
    {
        var salesQuery = _db.FarmerTransactions.Where(t => t.Type == FarmerTransactionType.Sale).AsQueryable();
        if (filter.DateFrom is not null) salesQuery = salesQuery.Where(t => t.Date >= filter.DateFrom);
        if (filter.DateTo is not null) salesQuery = salesQuery.Where(t => t.Date <= filter.DateTo);
        var sales = await salesQuery.Select(t => new { t.Date, t.SaleValue, t.Commission }).ToListAsync();

        var expenseQuery = _db.Expenses.AsQueryable();
        if (filter.DateFrom is not null) expenseQuery = expenseQuery.Where(e => e.Date >= filter.DateFrom);
        if (filter.DateTo is not null) expenseQuery = expenseQuery.Where(e => e.Date <= filter.DateTo);
        var expenses = await expenseQuery.Select(e => new { e.Date, e.Amount }).ToListAsync();

        string PeriodKey(DateTimeOffset d) => filter.Grouping?.ToLowerInvariant() switch
        {
            "daily" => d.ToString("yyyy-MM-dd"),
            "monthly" => d.ToString("yyyy-MM"),
            _ => "all"
        };

        var salesByPeriod = sales.GroupBy(s => PeriodKey(s.Date))
            .ToDictionary(g => g.Key, g => (Sales: g.Sum(x => x.SaleValue), Commission: g.Sum(x => x.Commission)));
        var expensesByPeriod = expenses.GroupBy(e => PeriodKey(e.Date))
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));

        var periods = salesByPeriod.Keys.Union(expensesByPeriod.Keys).OrderBy(p => p);

        return periods.Select(p =>
        {
            var (totalSales, totalCommission) = salesByPeriod.GetValueOrDefault(p, (0m, 0m));
            var totalExpenses = expensesByPeriod.GetValueOrDefault(p, 0m);
            return new MarketReportRow(p, totalSales, totalCommission, totalExpenses, totalCommission - totalExpenses);
        }).ToList();
    }

    /// <summary>
    /// Roadmap feature: aging of outstanding merchant balances (see the note on AgingReportRow
    /// for the allocation algorithm). This is always a "right now" snapshot — DateFrom/DateTo/
    /// Grouping on the shared filter type don't apply here, only PartnerId (to scope to one
    /// merchant) is honoured.
    /// </summary>
    public async Task<IReadOnlyList<AgingReportRow>> AgingReportAsync(ReportFilterRequest filter)
    {
        var invoiceQuery = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active);
        if (filter.PartnerId is not null) invoiceQuery = invoiceQuery.Where(i => i.MerchantId == filter.PartnerId);

        var invoices = await invoiceQuery
            .OrderBy(i => i.MerchantId).ThenBy(i => i.Date)
            .Select(i => new { i.Id, i.MerchantId, i.Merchant.Name, i.Date, i.TotalValue })
            .ToListAsync();

        var paymentQuery = _db.Payments.Where(p => p.Direction == PaymentDirection.FromMerchant);
        if (filter.PartnerId is not null) paymentQuery = paymentQuery.Where(p => p.PartnerId == filter.PartnerId);
        var payments = await paymentQuery
            .Select(p => new { p.PartnerId, p.InvoiceId, p.Amount })
            .ToListAsync();

        // Step 1: a payment explicitly linked to one invoice settles that invoice first.
        var remainingByInvoice = invoices.ToDictionary(i => i.Id, i => i.TotalValue);
        var leftoverByMerchant = new Dictionary<int, decimal>();
        foreach (var payment in payments)
        {
            if (payment.InvoiceId is not null && remainingByInvoice.ContainsKey(payment.InvoiceId.Value))
            {
                remainingByInvoice[payment.InvoiceId.Value] -= payment.Amount;
            }
            else
            {
                leftoverByMerchant[payment.PartnerId] = leftoverByMerchant.GetValueOrDefault(payment.PartnerId) + payment.Amount;
            }
        }

        // Step 2: whatever wasn't linked to a specific invoice is applied oldest-invoice-first —
        // the natural assumption when someone just pays down "what they owe" in general.
        var now = DateTimeOffset.UtcNow;
        var rows = new List<AgingReportRow>();
        foreach (var group in invoices.GroupBy(i => new { i.MerchantId, i.Name }))
        {
            var leftover = leftoverByMerchant.GetValueOrDefault(group.Key.MerchantId);
            decimal current = 0, days30 = 0, days60 = 0, days90 = 0;

            foreach (var invoice in group) // already ordered by Date ascending
            {
                var remaining = remainingByInvoice[invoice.Id];
                if (leftover > 0 && remaining > 0)
                {
                    var applied = Math.Min(leftover, remaining);
                    remaining -= applied;
                    leftover -= applied;
                }
                if (remaining <= 0) continue;

                var ageDays = (now - invoice.Date).TotalDays;
                if (ageDays < 30) current += remaining;
                else if (ageDays < 60) days30 += remaining;
                else if (ageDays < 90) days60 += remaining;
                else days90 += remaining;
            }

            var total = current + days30 + days60 + days90;
            if (total > 0)
                rows.Add(new AgingReportRow(group.Key.MerchantId, group.Key.Name, current, days30, days60, days90, total));
        }

        return rows.OrderByDescending(r => r.Total).ToList();
    }

    /// <summary>End-of-day closing summary for a single calendar date (see the note on DailyClosingDto).</summary>
    public async Task<DailyClosingDto> DailyClosingAsync(DateTimeOffset date)
    {
        var dayStart = new DateTimeOffset(date.Year, date.Month, date.Day, 0, 0, 0, date.Offset);
        var dayEnd = dayStart.AddDays(1);

        var invoiceCount = await _db.Invoices.CountAsync(i =>
            i.Status == InvoiceStatus.Active && i.Date >= dayStart && i.Date < dayEnd);
        var totalSalesValue = await _db.Invoices
            .Where(i => i.Status == InvoiceStatus.Active && i.Date >= dayStart && i.Date < dayEnd)
            .SumAsync(i => i.TotalValue);

        var totalCommission = await _db.FarmerTransactions
            .Where(t => t.Type == FarmerTransactionType.Sale && t.Date >= dayStart && t.Date < dayEnd)
            .SumAsync(t => t.Commission);

        var totalExpenses = await _db.Expenses
            .Where(e => e.Date >= dayStart && e.Date < dayEnd)
            .SumAsync(e => e.Amount);

        var paymentsFromMerchants = await _db.Payments
            .Where(p => p.Direction == PaymentDirection.FromMerchant && p.Date >= dayStart && p.Date < dayEnd)
            .SumAsync(p => p.Amount);

        var paymentsToFarmers = await _db.Payments
            .Where(p => p.Direction == PaymentDirection.ToFarmer && p.Date >= dayStart && p.Date < dayEnd)
            .SumAsync(p => p.Amount);

        return new DailyClosingDto(
            dayStart, invoiceCount, totalSalesValue, totalCommission, totalExpenses,
            totalCommission - totalExpenses, paymentsFromMerchants, paymentsToFarmers);
    }
}
