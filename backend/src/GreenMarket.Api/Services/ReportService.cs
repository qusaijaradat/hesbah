using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §8: farmer / merchant / market reports, all filterable, printable, exportable.</summary>
public interface IReportService
{
    Task<IReadOnlyList<FarmerReportRow>> FarmerReportAsync(ReportFilterRequest filter);
    Task<IReadOnlyList<MerchantReportRow>> MerchantReportAsync(ReportFilterRequest filter);

    /// <summary>See DriverReportRow's doc comment — the transport-side counterpart to FarmerReportAsync.</summary>
    Task<IReadOnlyList<DriverReportRow>> DriverReportAsync(ReportFilterRequest filter);
    Task<IReadOnlyList<MerchantItemBreakdownRow>> MerchantItemBreakdownAsync(ReportFilterRequest filter);

    /// <summary>See FarmerItemBreakdownRow's doc comment — the farmer-side counterpart to
    /// MerchantItemBreakdownAsync, used by "طباعة الفواتير"'s قسم البائع.</summary>
    Task<IReadOnlyList<FarmerItemBreakdownRow>> FarmerItemBreakdownAsync(ReportFilterRequest filter);

    /// <summary>See DriverItemBreakdownRow's doc comment — the driver-side counterpart, used by
    /// "طباعة الفواتير"'s قسم السائق.</summary>
    Task<IReadOnlyList<DriverItemBreakdownRow>> DriverItemBreakdownAsync(ReportFilterRequest filter);
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

        // Materialized in-memory (rather than a translated GroupBy) so TotalBoxes — a per-item
        // aggregate — and LastInvoiceDate can sit alongside the scalar sums, same reasoning as
        // MerchantItemBreakdownAsync/InvoiceService.ListAsync's ItemsSummary.
        var invoices = await invoiceQuery
            .Include(i => i.Farmer)
            .Include(i => i.Items)
            .ToListAsync();

        var invoiceAgg = invoices
            .GroupBy(i => new { FarmerId = i.FarmerId!.Value, i.Farmer!.Name })
            .Select(g => new
            {
                FarmerId = g.Key.FarmerId,
                FarmerName = g.Key.Name,
                InvoiceCount = g.Count(),
                TotalWeightKg = g.Sum(i => i.TotalWeightKg),
                TotalBoxes = g.Sum(i => i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => it.Quantity)),
                TotalSalesValue = g.Sum(i => i.TotalValue),
                LastInvoiceDate = (DateTimeOffset?)g.Max(i => i.Date)
            })
            .ToList();

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
        // always reflects reality, matching how the account statement screen computes it. Summing
        // EVERY transaction's Amount (no Type filter) already nets Sale/TransportFee/Payment/
        // Adjustment together correctly, on its own — see PartnerService.GetFarmerAccountAsync's
        // Remaining, which does the exact same sum for the exact same reason.
        // Note: "== null" here, not "is null" — pattern-matching ('is') can't appear inside
        // a lambda EF Core converts to an expression tree; plain equality can.
        var allTimeBalance = await _db.FarmerTransactions
            .Where(t => filter.PartnerId == null || t.FarmerId == filter.PartnerId)
            .GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Balance = g.Sum(t => t.Amount) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Balance);

        // Bug fix: Remaining here used to leave out the partner's manually-entered "الرصيد
        // الافتتاحي" (Partner.OpeningBalance) entirely, so this report's numbers could disagree
        // with the farmer's own كشف حساب page and the "قيمة الديون" overview the moment an opening
        // balance was set on them.
        var openingBalances = await _db.Partners
            .Where(p => filter.PartnerId == null || p.Id == filter.PartnerId)
            .Select(p => new { p.Id, p.OpeningBalance })
            .ToDictionaryAsync(x => x.Id, x => x.OpeningBalance ?? 0);

        return invoiceAgg.Select(a =>
        {
            var commission = commissionByFarmer.GetValueOrDefault(a.FarmerId);
            var opening = openingBalances.GetValueOrDefault(a.FarmerId);
            return new FarmerReportRow(
                a.FarmerId, a.FarmerName, a.InvoiceCount, a.TotalWeightKg, a.TotalBoxes, a.TotalSalesValue,
                commission, a.TotalSalesValue - commission, paidByFarmer.GetValueOrDefault(a.FarmerId),
                opening + allTimeBalance.GetValueOrDefault(a.FarmerId), opening, a.LastInvoiceDate);
        })
        .OrderBy(r => r.FarmerName)
        .ToList();
    }

    public async Task<IReadOnlyList<MerchantReportRow>> MerchantReportAsync(ReportFilterRequest filter)
    {
        var invoiceQuery = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active);
        if (filter.DateFrom is not null) invoiceQuery = invoiceQuery.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) invoiceQuery = invoiceQuery.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) invoiceQuery = invoiceQuery.Where(i => i.MerchantId == filter.PartnerId);

        // Materialized in-memory — same reasoning as FarmerReportAsync above — so TotalBoxes/
        // TotalWoodTotal (per-item aggregates) and LastInvoiceDate can sit alongside the scalars.
        var invoices = await invoiceQuery
            .Include(i => i.Merchant)
            .Include(i => i.Items)
            .ToListAsync();

        var invoiceAgg = invoices
            .GroupBy(i => new { i.MerchantId, i.Merchant.Name })
            .Select(g => new
            {
                MerchantId = g.Key.MerchantId,
                MerchantName = g.Key.Name,
                InvoiceCount = g.Count(),
                TotalWeightKg = g.Sum(i => i.TotalWeightKg),
                TotalBoxes = g.Sum(i => i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => it.Quantity)),
                TotalPurchases = g.Sum(i => i.TotalValue),
                TotalWoodTotal = g.Sum(i => i.Items.Sum(it => it.WoodPrice)),
                TotalTransportFee = g.Sum(i => i.TransportFee),
                LastInvoiceDate = (DateTimeOffset?)g.Max(i => i.Date)
            })
            .ToList();

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

        // Same bug fix as FarmerReportAsync above: fold in OpeningBalance so this matches the
        // merchant's own كشف حساب page and the "قيمة الديون" overview.
        var openingBalances = await _db.Partners
            .Where(p => filter.PartnerId == null || p.Id == filter.PartnerId)
            .Select(p => new { p.Id, p.OpeningBalance })
            .ToDictionaryAsync(x => x.Id, x => x.OpeningBalance ?? 0);

        return invoiceAgg.Select(a =>
        {
            var totalPaid = allTimePaid.GetValueOrDefault(a.MerchantId);
            var opening = openingBalances.GetValueOrDefault(a.MerchantId);
            var remaining = opening + allTimePurchases.GetValueOrDefault(a.MerchantId) - totalPaid;
            return new MerchantReportRow(
                a.MerchantId, a.MerchantName, a.InvoiceCount, a.TotalWeightKg, a.TotalBoxes,
                a.TotalPurchases, a.TotalWoodTotal, a.TotalTransportFee, a.TotalPurchases + a.TotalWoodTotal + a.TotalTransportFee,
                totalPaid, remaining, opening, a.LastInvoiceDate);
        })
        .OrderBy(r => r.MerchantName)
        .ToList();
    }

    /// <summary>See DriverReportRow's doc comment. Mirrors FarmerReportAsync's structure exactly —
    /// same shared farmer_transactions ledger, same Paid/Remaining/OpeningBalance formulas — just
    /// scoped to Invoice.DriverId instead of Invoice.FarmerId, and with TotalTransportFee (there is
    /// no "sale"/commission concept for a driver) in place of TotalSalesValue/TotalCommission.</summary>
    public async Task<IReadOnlyList<DriverReportRow>> DriverReportAsync(ReportFilterRequest filter)
    {
        var invoiceQuery = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active && i.DriverId != null);
        if (filter.DateFrom is not null) invoiceQuery = invoiceQuery.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) invoiceQuery = invoiceQuery.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) invoiceQuery = invoiceQuery.Where(i => i.DriverId == filter.PartnerId);

        var invoices = await invoiceQuery.Include(i => i.Driver).ToListAsync();

        var invoiceAgg = invoices
            .GroupBy(i => new { DriverId = i.DriverId!.Value, i.Driver!.Name })
            .Select(g => new
            {
                DriverId = g.Key.DriverId,
                DriverName = g.Key.Name,
                InvoiceCount = g.Count(),
                TotalTransportFee = g.Sum(i => i.TransportFee),
                LastInvoiceDate = (DateTimeOffset?)g.Max(i => i.Date)
            })
            .ToList();

        var paidQuery = _db.FarmerTransactions.Where(t => t.Type == FarmerTransactionType.Payment);
        if (filter.DateFrom is not null) paidQuery = paidQuery.Where(t => t.Date >= filter.DateFrom);
        if (filter.DateTo is not null) paidQuery = paidQuery.Where(t => t.Date <= filter.DateTo);
        if (filter.PartnerId is not null) paidQuery = paidQuery.Where(t => t.FarmerId == filter.PartnerId);
        var paidByDriver = await paidQuery.GroupBy(t => t.FarmerId)
            .Select(g => new { DriverId = g.Key, Paid = g.Sum(t => -t.Amount) })
            .ToDictionaryAsync(x => x.DriverId, x => x.Paid);

        // Same "all-time running balance" convention as FarmerReportAsync — see its comment above.
        var allTimeBalance = await _db.FarmerTransactions
            .Where(t => filter.PartnerId == null || t.FarmerId == filter.PartnerId)
            .GroupBy(t => t.FarmerId)
            .Select(g => new { DriverId = g.Key, Balance = g.Sum(t => t.Amount) })
            .ToDictionaryAsync(x => x.DriverId, x => x.Balance);

        var openingBalances = await _db.Partners
            .Where(p => filter.PartnerId == null || p.Id == filter.PartnerId)
            .Select(p => new { p.Id, p.OpeningBalance })
            .ToDictionaryAsync(x => x.Id, x => x.OpeningBalance ?? 0);

        return invoiceAgg.Select(a =>
        {
            var opening = openingBalances.GetValueOrDefault(a.DriverId);
            return new DriverReportRow(
                a.DriverId, a.DriverName, a.InvoiceCount, a.TotalTransportFee, paidByDriver.GetValueOrDefault(a.DriverId),
                opening + allTimeBalance.GetValueOrDefault(a.DriverId), opening, a.LastInvoiceDate);
        })
        .OrderBy(r => r.DriverName)
        .ToList();
    }

    /// <summary>
    /// Dashboard "كشف المشترين حسب الفترة": one row per (merchant, item) — see
    /// MerchantItemBreakdownRow's doc comment. Grouping happens IN MEMORY after materializing the
    /// period's invoices+items (same choice InvoiceService.GetFarmerGoodsAsync makes and for the
    /// same reason): a composite GroupBy key that also needs a navigation property's column
    /// (i.Merchant.Name here) doesn't reliably translate through the Npgsql EF provider, and this
    /// only ever runs over one filtered period's invoices, so it's cheap and safe to do here.
    /// </summary>
    public async Task<IReadOnlyList<MerchantItemBreakdownRow>> MerchantItemBreakdownAsync(ReportFilterRequest filter)
    {
        var query = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active).AsQueryable();
        if (filter.DateFrom is not null) query = query.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) query = query.Where(i => i.MerchantId == filter.PartnerId);

        var invoices = await query
            .Include(i => i.Merchant)
            .Include(i => i.Items)
            .ToListAsync();

        return invoices
            .SelectMany(i => i.Items.Select(it => new { i.MerchantId, MerchantName = i.Merchant.Name, it.ItemName, it.Unit, it.Quantity, it.LineTotal }))
            .GroupBy(x => new { x.MerchantId, x.MerchantName, x.ItemName, x.Unit })
            .Select(g => new MerchantItemBreakdownRow(g.Key.MerchantId, g.Key.MerchantName, g.Key.ItemName, g.Key.Unit, g.Sum(x => x.Quantity), g.Sum(x => x.LineTotal)))
            .OrderBy(r => r.MerchantName).ThenBy(r => r.ItemName)
            .ToList();
    }

    /// <summary>Farmer counterpart to MerchantItemBreakdownAsync above — see FarmerItemBreakdownRow's
    /// doc comment. Same in-memory grouping choice and same reasoning (a navigation-property column
    /// inside a composite GroupBy key doesn't reliably translate to SQL).</summary>
    public async Task<IReadOnlyList<FarmerItemBreakdownRow>> FarmerItemBreakdownAsync(ReportFilterRequest filter)
    {
        var query = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active && i.FarmerId != null);
        if (filter.DateFrom is not null) query = query.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) query = query.Where(i => i.FarmerId == filter.PartnerId);

        var invoices = await query
            .Include(i => i.Farmer)
            .Include(i => i.Items)
            .ToListAsync();

        return invoices
            .SelectMany(i => i.Items.Select(it => new { FarmerId = i.FarmerId!.Value, FarmerName = i.Farmer!.Name, it.ItemName, it.Unit, it.Quantity, it.LineTotal }))
            .GroupBy(x => new { x.FarmerId, x.FarmerName, x.ItemName, x.Unit })
            .Select(g => new FarmerItemBreakdownRow(g.Key.FarmerId, g.Key.FarmerName, g.Key.ItemName, g.Key.Unit, g.Sum(x => x.Quantity), g.Sum(x => x.LineTotal)))
            .OrderBy(r => r.FarmerName).ThenBy(r => r.ItemName)
            .ToList();
    }

    /// <summary>Driver counterpart — see DriverItemBreakdownRow's doc comment for why
    /// TotalTransportFee is computed once per INVOICE (never per item line) and then simply repeated
    /// across that driver's rows rather than summed per item.</summary>
    public async Task<IReadOnlyList<DriverItemBreakdownRow>> DriverItemBreakdownAsync(ReportFilterRequest filter)
    {
        var query = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active && i.DriverId != null);
        if (filter.DateFrom is not null) query = query.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(i => i.Date <= filter.DateTo);
        if (filter.PartnerId is not null) query = query.Where(i => i.DriverId == filter.PartnerId);

        var invoices = await query
            .Include(i => i.Driver)
            .Include(i => i.Items)
            .ToListAsync();

        var feeByDriver = invoices
            .GroupBy(i => i.DriverId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(i => i.TransportFee));

        return invoices
            .SelectMany(i => i.Items.Select(it => new { DriverId = i.DriverId!.Value, DriverName = i.Driver!.Name, it.ItemName, it.Unit, it.Quantity }))
            .GroupBy(x => new { x.DriverId, x.DriverName, x.ItemName, x.Unit })
            .Select(g => new DriverItemBreakdownRow(g.Key.DriverId, g.Key.DriverName, g.Key.ItemName, g.Key.Unit, g.Sum(x => x.Quantity), feeByDriver.GetValueOrDefault(g.Key.DriverId)))
            .OrderBy(r => r.DriverName).ThenBy(r => r.ItemName)
            .ToList();
    }

    public async Task<IReadOnlyList<MarketReportRow>> MarketReportAsync(ReportFilterRequest filter)
    {
        // Bug fix: the market earns its commission on every active sale it brokers — whether or
        // not a specific farmer is tracked on that invoice (a lot of produce is priced and sold
        // by the market itself without a farmer ever being entered as a separate partner) — but
        // this used to read from FarmerTransactions, which only ever has a row for invoices that
        // DO have a farmer attached. That silently dropped every farmer-less sale from the whole
        // report (and from Daily Closing — see DailyClosingAsync below), showing 0 commission for
        // days/periods that were entirely farmer-less even with a real commission rate configured.
        // Reading straight from Invoices (which always carries its own CommissionRateApplied and
        // TotalValue, farmer or no farmer) fixes that.
        var salesQuery = _db.Invoices.Where(i => i.Status == InvoiceStatus.Active).AsQueryable();
        if (filter.DateFrom is not null) salesQuery = salesQuery.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) salesQuery = salesQuery.Where(i => i.Date <= filter.DateTo);
        var sales = await salesQuery.Select(i => new { i.Date, i.TotalValue, i.CommissionRateApplied }).ToListAsync();

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
            .ToDictionary(g => g.Key, g => (
                Sales: g.Sum(x => x.TotalValue),
                Commission: g.Sum(x => CommissionCalculator.Calculate(x.TotalValue, x.CommissionRateApplied).Commission)));
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

        // Bug fix: commission used to be summed from FarmerTransactions, which only has a row for
        // invoices that have a farmer attached — a day where every sale was farmer-less (common:
        // a lot of produce is priced and sold by the market itself without a farmer ever being
        // entered as a separate partner) showed "عمولة 0" even with a real commission rate set in
        // Settings. The commission is the market's own cut on every active sale regardless of
        // whether a farmer is tracked, so this now reads straight off each invoice's own stored
        // TotalValue/CommissionRateApplied (see MarketReportAsync above for the same fix).
        var invoicesToday = await _db.Invoices
            .Where(i => i.Status == InvoiceStatus.Active && i.Date >= dayStart && i.Date < dayEnd)
            .Select(i => new { i.TotalValue, i.CommissionRateApplied })
            .ToListAsync();

        var invoiceCount = invoicesToday.Count;
        var totalSalesValue = invoicesToday.Sum(i => i.TotalValue);
        var totalCommission = invoicesToday.Sum(i => CommissionCalculator.Calculate(i.TotalValue, i.CommissionRateApplied).Commission);

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
