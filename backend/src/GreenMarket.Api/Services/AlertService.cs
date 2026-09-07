using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// The things that need attention right now, shown as a banner across the top of every page.
///
/// Before this there was exactly one such banner ("شيك تاريخ صرفه اليوم"), hard-wired to one
/// question. Everything else that quietly goes wrong in a market — a check whose date passed a
/// week ago, goods that went out without a price and were never priced — only surfaced if someone
/// happened to open the right page and look. These follow you instead.
///
/// Deliberately a SHORT list. A banner earns its place by being rare and actionable: three things
/// that are wrong today get read, seven things that are always on get ignored, and then the one
/// that mattered gets ignored with them. So this holds only what is both time-sensitive and
/// fixable now:
///
///   • checks past their due date, still قيد التحصيل — money that should already be collected;
///   • checks due today — the original banner, kept;
///   • invoices carrying an unpriced line — every day that passes makes the price harder to
///     reconstruct honestly.
///
/// Left out on purpose: unpaid invoices (in a credit market that is the normal state, not an
/// exception — it would be permanently on), checks due later this week (real, but not actionable
/// today, and already on the dashboard), and credit limits (that whole feature is switched off by
/// CREDIT_LIMIT_UI_ENABLED — an alert would be resurrecting it through the back door).
/// </summary>
public interface IAlertService
{
    /// <summary>
    /// <paramref name="includeChecks"/>/<paramref name="includeInvoices"/> come from the caller's
    /// own permissions — a role without payments.view must not learn about checks through a
    /// banner it was never allowed to see the page for.
    /// </summary>
    Task<IReadOnlyList<AlertDto>> GetAsync(bool includeChecks, bool includeInvoices);
}

public class AlertService : IAlertService
{
    private readonly AppDbContext _db;

    public AlertService(AppDbContext db) => _db = db;

    /// <summary>How many names an alert carries before it just says how many there are.</summary>
    private const int MaxNames = 4;

    public async Task<IReadOnlyList<AlertDto>> GetAsync(bool includeChecks, bool includeInvoices)
    {
        var alerts = new List<AlertDto>();

        if (includeChecks)
        {
            var todayUtc = CheckUrgency.TodayUtc();
            var pending = await _db.Payments
                .Where(p => p.CheckDueDate != null && p.CheckStatus == CheckClearanceStatus.Pending)
                .Select(p => new { p.Amount, p.Partner.Name, DueDate = p.CheckDueDate!.Value })
                .ToListAsync();

            var overdue = pending.Where(c => CheckUrgency.IsOverdue(c.DueDate, todayUtc)).ToList();
            if (overdue.Count > 0)
                alerts.Add(new AlertDto(
                    AlertKind.OverdueChecks, AlertSeverity.Critical,
                    overdue.Count, overdue.Sum(c => c.Amount),
                    Names(overdue.Select(c => c.Name))));

            var dueToday = pending.Where(c => CheckUrgency.IsDueToday(c.DueDate, todayUtc)).ToList();
            if (dueToday.Count > 0)
                alerts.Add(new AlertDto(
                    AlertKind.ChecksDueToday, AlertSeverity.Warning,
                    dueToday.Count, dueToday.Sum(c => c.Amount),
                    Names(dueToday.Select(c => c.Name))));
        }

        if (includeInvoices)
        {
            // Same condition the invoices list filters by, so this count and the list the banner
            // links to can never disagree.
            var unpriced = await _db.Invoices
                .Where(i => i.Status == InvoiceStatus.Active && i.Items.Any(it => it.PricePerUnit == 0))
                .Select(i => i.Merchant.Name)
                .ToListAsync();
            if (unpriced.Count > 0)
                alerts.Add(new AlertDto(
                    AlertKind.UnpricedInvoices, AlertSeverity.Warning,
                    unpriced.Count, 0m, Names(unpriced)));
        }

        // Worst first, so the row that matters most is the one read first.
        return alerts.OrderByDescending(a => a.Severity).ToList();
    }

    /// <summary>Distinct names, capped — the banner is a pointer to a page, not a copy of it.</summary>
    private static IReadOnlyList<string> Names(IEnumerable<string> names) =>
        names.Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().Take(MaxNames).ToList();
}
