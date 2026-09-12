using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Domain.Services.Ask;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services.Ask;

/// <summary>
/// Answers one question by running the plan the model produced. Every branch below calls a service
/// the rest of the app already calls, so an answer here can never disagree with the screen showing
/// the same figure — and none of the numbers come from the model, which only picked which question
/// was being asked.
/// </summary>
public interface IAskService
{
    Task<AskAnswerDto> AskAsync(string question, CancellationToken cancellationToken = default);
}

public class AskService : IAskService
{
    private readonly AppDbContext _db;
    private readonly IAskPlanner _planner;
    private readonly IPartnerService _partners;
    private readonly IReportService _reports;
    private readonly IContainerService _containers;
    private readonly ILogger<AskService> _logger;

    public AskService(
        AppDbContext db, IAskPlanner planner, IPartnerService partners,
        IReportService reports, IContainerService containers, ILogger<AskService> logger)
    {
        _db = db;
        _planner = planner;
        _partners = partners;
        _reports = reports;
        _containers = containers;
        _logger = logger;
    }

    /// <summary>A "top N" question never returns more than this, however many the model asked for.</summary>
    private const int MaxRows = 20;

    public async Task<AskAnswerDto> AskAsync(string question, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(question))
            throw new ValidationAppException("اكتب سؤالك أولًا.");
        if (question.Length > 500)
            throw new ValidationAppException("السؤال طويل — اختصره.");
        if (!_planner.IsConfigured)
            throw new ValidationAppException("ميزة السؤال مش مفعّلة — لازم مفتاح Anthropic بالإعدادات.");

        var plan = await _planner.PlanAsync(question, cancellationToken);
        _logger.LogInformation("Ask: {Intent} for {Question}", plan.Intent, question);

        var limit = Math.Clamp(plan.Limit ?? 5, 1, MaxRows);
        var filter = new ReportFilterRequest { DateFrom = plan.DateFrom, DateTo = plan.DateTo };

        return plan.Intent switch
        {
            AskIntent.PartnerBalance => await PartnerBalance(plan),
            AskIntent.TopDebtors => await TopDebtors(plan, limit),
            AskIntent.TopCreditors => await TopCreditors(plan, limit),
            AskIntent.PartnerSales => await PartnerSales(plan, filter),
            AskIntent.PartnerPurchases => await PartnerPurchases(plan, filter),
            AskIntent.TopItems => await TopItems(plan, filter, limit),
            AskIntent.MarketProfit => await MarketProfit(plan, filter),
            AskIntent.DailyClosing => await DailyClosing(plan),
            AskIntent.UnpaidInvoices => await UnpaidInvoices(plan, limit),
            AskIntent.UnpricedInvoices => await UnpricedInvoices(plan, limit),
            AskIntent.ChecksDue => await ChecksDue(plan, limit),
            AskIntent.ContainersHeld => await ContainersHeld(plan, limit),
            _ => new AskAnswerDto(
                plan.Intent.ToString(), plan.Understood,
                "ما بعرف أجاوب على هاد السؤال. جرّب تسأل عن رصيد شخص، أو الديون، أو المبيعات بفترة، أو الإغلاق اليومي.",
                Array.Empty<AskRowDto>(), null),
        };
    }

    /// <summary>
    /// Finds the person the question named. The model reads a name out of free text, so it can come
    /// back with spacing or an alternative spelling — matched the same loose way the pickers match,
    /// and never trusted to be exact. More than one match is reported rather than guessed at: on a
    /// question about money, "which سامي did you mean" beats a confident answer about the wrong one.
    /// </summary>
    private async Task<(Partner? Partner, AskAnswerDto? Problem)> ResolvePartner(AskPlan plan)
    {
        var name = plan.PartnerName?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return (null, Answer(plan, "السؤال ما فيه اسم — مين بالظبط؟"));

        var normalized = name.ToLower();
        var matches = await _db.Partners
            .Where(p => p.Name.ToLower() == normalized || p.Name.ToLower().Contains(normalized))
            .OrderBy(p => p.Name.Length)
            .Take(6)
            .ToListAsync();

        if (matches.Count == 0)
            return (null, Answer(plan, $"ما لقيت حدا اسمه \"{name}\"."));

        var exact = matches.FirstOrDefault(p => string.Equals(p.Name.Trim(), name, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return (exact, null);

        if (matches.Count > 1)
            return (null, new AskAnswerDto(
                plan.Intent.ToString(), plan.Understood,
                $"في أكتر من شخص اسمه قريب من \"{name}\" — حدّد مين:",
                matches.Select(p => new AskRowDto(p.Name, PartnerRoles.Label(p.Type), null)).ToList(),
                null));

        return (matches[0], null);
    }

    private static AskAnswerDto Answer(AskPlan plan, string text, IReadOnlyList<AskRowDto>? rows = null, string? period = null) =>
        new(plan.Intent.ToString(), plan.Understood, text, rows ?? Array.Empty<AskRowDto>(), period);

    private static string Money(decimal v) => $"₪ {v:0.##}";

    /// <summary>The period an answer actually covers, said out loud — an answer over the wrong dates
    /// is the failure mode here, and it is invisible unless the dates are printed beside the number.</summary>
    private static string? Period(ReportFilterRequest f) =>
        f.DateFrom is null && f.DateTo is null
            ? "كل الفترات"
            : $"{f.DateFrom?.ToString("yyyy-MM-dd") ?? "البداية"} ← {f.DateTo?.ToString("yyyy-MM-dd") ?? "اليوم"}";

    // ---------------------------------------------------------------- balances

    private async Task<AskAnswerDto> PartnerBalance(AskPlan plan)
    {
        var (partner, problem) = await ResolvePartner(plan);
        if (problem is not null) return problem;

        var rows = new List<AskRowDto>();
        if (PartnerRoles.HasSellerSide(partner!.Type))
        {
            var account = await _partners.GetFarmerAccountAsync(partner.Id);
            rows.Add(new AskRowDto(
                PartnerRoles.Has(partner.Type, PartnerType.Driver) && !PartnerRoles.Has(partner.Type, PartnerType.Farmer) ? "كسائق" : "كبائع",
                account.Remaining >= 0 ? "إلو عنا" : "علينا إلو",
                Math.Abs(account.Remaining)));
        }
        if (PartnerRoles.Has(partner.Type, PartnerType.Merchant))
        {
            var account = await _partners.GetMerchantAccountAsync(partner.Id);
            rows.Add(new AskRowDto("كمشتري", account.Remaining >= 0 ? "عليه" : "دافع زيادة", Math.Abs(account.Remaining)));
        }

        if (rows.Count == 0)
            return Answer(plan, $"{partner.Name} ما إلو حركات لحد هلأ.");

        return Answer(plan, $"رصيد {partner.Name}:", rows);
    }

    private async Task<AskAnswerDto> TopDebtors(AskPlan plan, int limit)
    {
        var debts = await _partners.GetDebtsOverviewAsync();
        var rows = debts.Merchants.Where(r => r.Remaining > 0).Take(limit)
            .Select(r => new AskRowDto(r.Name, "عليه", r.Remaining)).ToList();
        return rows.Count == 0
            ? Answer(plan, "ما في ولا مشتري عليه دين هلأ.")
            : Answer(plan, $"أكتر {rows.Count} مشتري عليهم دين:", rows);
    }

    private async Task<AskAnswerDto> TopCreditors(AskPlan plan, int limit)
    {
        var debts = await _partners.GetDebtsOverviewAsync();
        var rows = debts.Farmers.Concat(debts.Drivers)
            .Where(r => r.Remaining > 0)
            .OrderByDescending(r => r.Remaining).Take(limit)
            .Select(r => new AskRowDto(r.Name, "إلو عنا", r.Remaining)).ToList();
        return rows.Count == 0
            ? Answer(plan, "ما في ولا حدا إلو مستحقات هلأ.")
            : Answer(plan, $"أكتر {rows.Count} واحد إلهم مستحقات:", rows);
    }

    // ---------------------------------------------------------------- periods

    private async Task<AskAnswerDto> PartnerSales(AskPlan plan, ReportFilterRequest filter)
    {
        var (partner, problem) = await ResolvePartner(plan);
        if (problem is not null) return problem;

        var row = (await _reports.FarmerReportAsync(filter)).FirstOrDefault(r => r.FarmerId == partner!.Id);
        if (row is null) return Answer(plan, $"{partner!.Name} ما باع إشي بهالفترة.", null, Period(filter));

        return Answer(plan, $"{partner!.Name} بهالفترة:", new List<AskRowDto>
        {
            new("قيمة المبيعات", $"{row.InvoiceCount} فاتورة", row.TotalSalesValue),
            new("العمولة", "مخصومة", row.TotalCommission),
            new("الصافي المستحق", "", row.NetDue),
            new("المدفوع إلو", "", row.TotalPaid),
            new("المتبقي", "", row.Remaining),
        }, Period(filter));
    }

    private async Task<AskAnswerDto> PartnerPurchases(AskPlan plan, ReportFilterRequest filter)
    {
        var (partner, problem) = await ResolvePartner(plan);
        if (problem is not null) return problem;

        var row = (await _reports.MerchantReportAsync(filter)).FirstOrDefault(r => r.MerchantId == partner!.Id);
        if (row is null) return Answer(plan, $"{partner!.Name} ما اشترى إشي بهالفترة.", null, Period(filter));

        return Answer(plan, $"{partner!.Name} بهالفترة:", new List<AskRowDto>
        {
            new("قيمة المشتريات", $"{row.InvoiceCount} فاتورة", row.TotalPurchases),
            new("الإجمالي الكلي", "مع الخشب والصناديق", row.GrandTotal),
            new("المدفوع", "", row.TotalPaid),
            new("المتبقي", "", row.Remaining),
        }, Period(filter));
    }

    private async Task<AskAnswerDto> TopItems(AskPlan plan, ReportFilterRequest filter, int limit)
    {
        var rows = (await _reports.MerchantItemBreakdownAsync(filter))
            .GroupBy(r => r.ItemName)
            .Select(g => new { Item = g.Key, Value = g.Sum(x => x.TotalValue), Count = g.Sum(x => x.TotalQuantity) })
            .OrderByDescending(x => x.Value)
            .Take(limit)
            .Select(x => new AskRowDto(x.Item, $"عدد {x.Count:0.##}", x.Value))
            .ToList();

        return rows.Count == 0
            ? Answer(plan, "ما في مبيعات بهالفترة.", null, Period(filter))
            : Answer(plan, $"أكتر {rows.Count} صنف مبيعًا:", rows, Period(filter));
    }

    private async Task<AskAnswerDto> MarketProfit(AskPlan plan, ReportFilterRequest filter)
    {
        var rows = await _reports.MarketReportAsync(filter);
        if (rows.Count == 0) return Answer(plan, "ما في حركة بهالفترة.", null, Period(filter));

        return Answer(plan, "ربح المصلحة بهالفترة:", new List<AskRowDto>
        {
            new("المبيعات", "", rows.Sum(r => r.TotalSalesValue)),
            new("العمولة", "", rows.Sum(r => r.TotalCommission)),
            new("رسوم الصناديق", "", rows.Sum(r => r.BoxFeeIncome)),
            new("سعر الخشب", "", rows.Sum(r => r.WoodIncome)),
            new("المصاريف", "مخصومة", rows.Sum(r => r.TotalExpenses)),
            new("الصافي", "", rows.Sum(r => r.NetProfit)),
        }, Period(filter));
    }

    private async Task<AskAnswerDto> DailyClosing(AskPlan plan)
    {
        var day = plan.DateFrom ?? plan.DateTo ?? DateTimeOffset.Now;
        var closing = await _reports.DailyClosingAsync(day);
        return Answer(plan, $"إغلاق يوم {day:yyyy-MM-dd}:", new List<AskRowDto>
        {
            new("عدد الفواتير", "", closing.InvoiceCount),
            new("المبيعات", "", closing.TotalSalesValue),
            new("العمولة", "", closing.TotalCommission),
            new("المصاريف", "", closing.TotalExpenses),
            new("صافي الربح", "", closing.NetProfit),
            new("مقبوض من المشترين", "", closing.PaymentsReceivedFromMerchants),
            new("مدفوع للباعة", "", closing.PaymentsPaidToFarmers),
        });
    }

    // ---------------------------------------------------------------- attention lists

    private async Task<AskAnswerDto> UnpaidInvoices(AskPlan plan, int limit)
    {
        var summary = await _reports.DashboardSummaryAsync();
        var rows = summary.TopMerchantDebts.Take(limit)
            .Select(r => new AskRowDto(r.Name, "عليه", r.Remaining)).ToList();
        return Answer(plan,
            $"في {summary.UnpaidInvoiceCount} فاتورة غير مدفوعة بقيمة {Money(summary.UnpaidInvoiceAmount)}."
            + (rows.Count > 0 ? " أكبر الأرصدة:" : ""), rows);
    }

    private async Task<AskAnswerDto> UnpricedInvoices(AskPlan plan, int limit)
    {
        var unpriced = await _db.Invoices
            .Where(i => i.Status == InvoiceStatus.Active && i.Items.Any(it => it.PricePerUnit == 0))
            .OrderByDescending(i => i.Date)
            .Take(limit)
            .Select(i => new { i.InvoiceNumber, i.Date, Merchant = i.Merchant.Name })
            .ToListAsync();

        return unpriced.Count == 0
            ? Answer(plan, "ما في ولا فاتورة فيها صنف بدون سعر. 👍")
            : Answer(plan, $"في {unpriced.Count} فاتورة فيها أصناف بدون سعر:",
                unpriced.Select(i => new AskRowDto(i.InvoiceNumber, $"{i.Merchant} — {i.Date:yyyy-MM-dd}", null)).ToList());
    }

    private async Task<AskAnswerDto> ChecksDue(AskPlan plan, int limit)
    {
        var today = CheckUrgency.TodayUtc();
        var pending = await _db.Payments
            .Where(p => p.CheckDueDate != null && p.CheckStatus == CheckClearanceStatus.Pending)
            .Select(p => new { p.Amount, Name = p.Partner.Name, Due = p.CheckDueDate!.Value })
            .ToListAsync();

        var due = pending
            .Where(c => CheckUrgency.IsOverdue(c.Due, today) || CheckUrgency.IsDueToday(c.Due, today))
            .OrderBy(c => c.Due)
            .Take(limit)
            .Select(c => new AskRowDto(c.Name, CheckUrgency.IsOverdue(c.Due, today) ? $"متأخر — {c.Due:yyyy-MM-dd}" : "مستحق اليوم", c.Amount))
            .ToList();

        return due.Count == 0
            ? Answer(plan, "ما في شيكات مستحقة أو متأخرة اليوم.")
            : Answer(plan, $"في {due.Count} شيك مستحق أو متأخر:", due);
    }

    private async Task<AskAnswerDto> ContainersHeld(AskPlan plan, int limit)
    {
        var holders = await _containers.GetHoldersAsync();
        var rows = holders.Where(h => h.Remaining > 0).Take(limit)
            .Select(h => new AskRowDto(h.PartnerName, ContainerLabel(h.Type), h.Remaining)).ToList();
        return rows.Count == 0
            ? Answer(plan, "ما حدا ماسك صناديق للمصلحة هلأ.")
            : Answer(plan, $"أكتر {rows.Count} واحد ماسك أوعية:", rows);
    }

    private static string ContainerLabel(ContainerType type) => type switch
    {
        ContainerType.Box => "صناديق",
        ContainerType.Carton => "كرتون",
        ContainerType.Sack => "مخالات",
        _ => type.ToString(),
    };
}
