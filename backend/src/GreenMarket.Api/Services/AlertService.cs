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
    /// Takes the caller's permission keys and asks <see cref="AlertVisibility"/> what they may be
    /// told — never booleans worked out by the caller. Two callers build these alerts (the banner
    /// and the morning push) and each used to compute the same flags from its own copy of the
    /// rule; the rule now has one home and they both ask it.
    /// </summary>
    Task<IReadOnlyList<AlertDto>> GetAsync(IEnumerable<string> permissions);
}

public class AlertService : IAlertService
{
    private readonly AppDbContext _db;

    public AlertService(AppDbContext db) => _db = db;

    /// <summary>How many names an alert carries before it just says how many there are.</summary>
    private const int MaxNames = 4;

    /// <summary>
    /// How long a person can hold the market's sacks before it is worth saying so out loud.
    ///
    /// Thirty days, chosen by the market. Sacks go out and come back within days, so this is long
    /// enough that nobody is nagged about this morning's handover and short enough to still be
    /// worth chasing. A banner that fires too easily stops being read, which costs more than
    /// having no banner.
    /// </summary>
    private const int StaleSackDays = 30;

    public async Task<IReadOnlyList<AlertDto>> GetAsync(IEnumerable<string> permissions)
    {
        var visible = AlertVisibility.For(permissions);
        var alerts = new List<AlertDto>();
        // Nothing this person may be told, and therefore nothing worth querying for.
        if (visible.None) return alerts;

        if (visible.Checks)
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

        if (visible.Invoices)
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

        if (visible.Sacks)
        {
            // Out minus in, per PERSON rather than per kind: the question a banner answers is who
            // to call, and somebody square overall is nobody to call even if one colour is off.
            var byPartner = await _db.ContainerMovements
                .Where(m => m.Type == ContainerType.Sack)
                .GroupBy(m => new { m.PartnerId, m.Partner.Name })
                .Select(g => new
                {
                    g.Key.Name,
                    Held = g.Sum(m => m.Direction == ContainerDirection.Out ? m.Quantity : -m.Quantity),
                    LastMoved = g.Max(m => m.Date),
                })
                .ToListAsync();

            // Sacks a seller brought in with his produce are the market holding HIS — they reduce
            // what he owes, exactly as they do on the sacks screen, so the two can never disagree
            // about whether somebody is square.
            var brought = await _db.FarmerGoodsEntries
                .Where(e => e.SackQuantity > 0)
                .GroupBy(e => e.Farmer.Name)
                .Select(g => new { Name = g.Key, Qty = g.Sum(e => e.SackQuantity) })
                .ToDictionaryAsync(x => x.Name, x => x.Qty);

            var cutoff = DateTimeOffset.UtcNow.AddDays(-StaleSackDays);
            var stale = byPartner
                .Select(p => new { p.Name, Held = p.Held - brought.GetValueOrDefault(p.Name), p.LastMoved })
                // Held > 0 only: somebody the market owes sacks to is not somebody to chase.
                .Where(p => p.Held > 0 && p.LastMoved < cutoff)
                .OrderByDescending(p => p.Held)
                .ToList();

            if (stale.Count > 0)
                alerts.Add(new AlertDto(
                    AlertKind.StaleSacks, AlertSeverity.Warning,
                    stale.Count, stale.Sum(p => p.Held),
                    Names(stale.Select(p => p.Name))));
        }

        // Worst first, so the row that matters most is the one read first.
        return alerts.OrderByDescending(a => a.Severity).ToList();
    }

    /// <summary>Distinct names, capped — the banner is a pointer to a page, not a copy of it.</summary>
    private static IReadOnlyList<string> Names(IEnumerable<string> names) =>
        names.Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().Take(MaxNames).ToList();
}
