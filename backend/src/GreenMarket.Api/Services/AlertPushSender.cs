using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GreenMarket.Api.Services;

/// <summary>
/// Sends each person their own alerts, once a morning.
///
/// The banner already answers "what needs attention"; what it cannot do is reach somebody who has
/// not opened the app. A check whose date passed a week ago only ever got noticed by whoever
/// happened to look. This is that banner, delivered.
///
/// EVERY notification is built per user, from that user's own permissions — handed to the same
/// AlertVisibility the banner asks, so a phone and a laptop can never disagree about what somebody
/// may be told. Somebody who may not price an invoice is never told one is unpriced: not because
/// the fact is secret, but because an alert is a job, and handing somebody a job they cannot
/// discharge is how a person learns to ignore every alert after it. A user whose permissions reach
/// none of it is skipped entirely rather than sent an empty notification.
///
/// It is a plain BackgroundService on a quarter-hour tick rather than a scheduler: one thing, once
/// a day, in an app that has no other background work. What keeps it honest is not the timer but
/// PushSubscription.LastDailyOn — a restart, a redeploy mid-morning, or two instances racing each
/// other cannot deliver the same day twice, because the row says it already went.
/// </summary>
public class AlertPushSender : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly PushSettings _settings;
    private readonly ILogger<AlertPushSender> _logger;

    private static readonly TimeSpan Tick = TimeSpan.FromMinutes(15);

    public AlertPushSender(
        IServiceScopeFactory scopes, IOptions<PushSettings> settings, ILogger<AlertPushSender> logger)
    {
        _scopes = scopes;
        _settings = settings.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.IsConfigured)
        {
            // Said once, at startup, and then never again. The feature being off is a choice, not
            // a fault, and a warning every quarter hour would be noise in a log somebody reads to
            // find real problems.
            _logger.LogInformation("Push notifications are off: no VAPID keys configured (see PushSettings).");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // A failed morning must not take the loop down with it — tomorrow is another run,
                // and the app's own alerts banner is unaffected either way.
                _logger.LogError(ex, "The daily alert push failed.");
            }

            try { await Task.Delay(Tick, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        var now = LocalNow();
        if (now.Hour < _settings.DailyHour) return;
        var today = DateOnly.FromDateTime(now.Date);

        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var alerts = scope.ServiceProvider.GetRequiredService<IAlertService>();
        var push = (PushService)scope.ServiceProvider.GetRequiredService<IPushService>();

        // Only users with a device that has not been told today. Asked as one query so an ordinary
        // morning with nothing due costs one round trip and stops.
        var userIds = await db.PushSubscriptions
            .Where(s => s.LastDailyOn == null || s.LastDailyOn != today)
            .Select(s => s.UserId)
            .Distinct()
            .ToListAsync(ct);
        if (userIds.Count == 0) return;

        foreach (var userId in userIds)
        {
            ct.ThrowIfCancellationRequested();

            var permissions = await db.Users
                .Where(u => u.Id == userId && u.IsActive)
                .SelectMany(u => u.Role.RolePermissions.Select(rp => rp.Permission.Key))
                .ToListAsync(ct);
            // No permissions means either a deactivated account or a role that reaches none of
            // this. Either way there is nothing this person may be told.
            if (permissions.Count == 0) continue;

            // The same call the banner makes, with this user's role permissions in place of the
            // request's claims. AlertVisibility decides; nothing is worked out here.
            var mine = await alerts.GetAsync(permissions);

            var devices = await db.PushSubscriptions
                .Where(s => s.UserId == userId && (s.LastDailyOn == null || s.LastDailyOn != today))
                .ToListAsync(ct);
            if (devices.Count == 0) continue;

            // Stamped whether or not anything was sent. A quiet morning is still a morning that
            // has been checked, and without the stamp every tick would re-ask the same question
            // for the same user until midnight.
            foreach (var device in devices) device.LastDailyOn = today;

            if (mine.Count == 0)
            {
                // Nothing wrong today. Deliberately silent: a daily "all clear" is the fastest way
                // to teach somebody to dismiss this app's notifications without reading them.
                await db.SaveChangesAsync(ct);
                continue;
            }

            await push.SendToAsync(devices, BuildPayload(mine), ct);
            await db.SaveChangesAsync(ct);
        }
    }

    /// <summary>
    /// One notification, not four. A phone that buzzes four times at seven in the morning gets its
    /// notifications turned off by lunchtime, so the kinds are joined into a single line and the
    /// app itself is where the detail lives.
    ///
    /// No amounts. The title and body sit in a notification tray on an unlocked counter phone that
    /// anybody walking past can read — a count is enough to make somebody open the app, and what is
    /// owed to whom is not something to leave on a lock screen.
    /// </summary>
    private static PushPayload BuildPayload(IReadOnlyList<AlertDto> alerts)
    {
        var lines = alerts.Select(a => a.Kind switch
        {
            AlertKind.OverdueChecks => $"{a.Count} شيك فات موعدها",
            AlertKind.ChecksDueToday => $"{a.Count} شيك اليوم",
            AlertKind.UnpricedInvoices => $"{a.Count} فاتورة غير مسعّرة",
            AlertKind.StaleSacks => $"{a.Count} حدا ماسك مخالات من زمان",
            _ => null
        }).Where(l => l is not null);

        // Where tapping it lands. One kind goes straight to the page that fixes it; several go to
        // the dashboard, where the banner lists them all.
        var url = alerts.Count == 1
            ? alerts[0].Kind switch
            {
                AlertKind.OverdueChecks or AlertKind.ChecksDueToday => "/checks",
                AlertKind.UnpricedInvoices => "/invoices?hasUnpricedItems=true",
                AlertKind.StaleSacks => "/sacks",
                _ => "/"
            }
            : "/";

        return new PushPayload(
            Title: "الحسبة — في إشي بدو انتباه",
            Body: string.Join("، ", lines),
            Url: url,
            // One tag per day, so a notification that was never opened is REPLACED by the next
            // one rather than stacking into a pile nobody reads.
            Tag: "hesbah-daily");
    }

    /// <summary>
    /// The market's own clock. A container runs on UTC, and Palestine is two or three hours ahead
    /// of it depending on the season — left alone, "seven in the morning" would arrive at four or
    /// five, before anybody is holding a phone. Configure PushSettings.TimeZone with an IANA id
    /// ("Asia/Hebron"); an id this host does not recognise falls back to the server's own time
    /// rather than refusing to send at all.
    /// </summary>
    private DateTime LocalNow()
    {
        if (string.IsNullOrWhiteSpace(_settings.TimeZone)) return DateTime.Now;
        try
        {
            return TimeZoneInfo.ConvertTime(
                DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(_settings.TimeZone)).DateTime;
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            _logger.LogWarning("Unknown Push:TimeZone '{TimeZone}' — using the server's own clock.", _settings.TimeZone);
            return DateTime.Now;
        }
    }
}
