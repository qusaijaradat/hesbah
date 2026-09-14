using System.Net;
using System.Text.Json;
using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WebPush;
using Entity = GreenMarket.Domain.Entities;

namespace GreenMarket.Api.Services;

/// <summary>
/// Phone notifications, over the Web Push protocol.
///
/// No app store is involved, and no notification service of ours: the browser hands us an endpoint
/// belonging to Apple, Google or Mozilla, and we hand THEM an encrypted payload they cannot read
/// and are obliged to deliver. Which is why this works on an iPhone at all — but only on one where
/// the app has been added to the home screen. In a Safari tab, iOS offers no subscription at all,
/// and the switch on the settings screen says so rather than failing silently.
///
/// What a device receives is decided by WHO it belongs to, never by what is happening in the
/// market: see AlertPushSender. A subscription is per user, and it is dropped on sign-out,
/// because a counter phone that two people share must not tell the second one what the first was
/// allowed to see.
/// </summary>
public interface IPushService
{
    Task<PushStatusDto> GetStatusAsync(int userId, CancellationToken ct = default);
    Task SubscribeAsync(int userId, PushSubscribeRequest request, CancellationToken ct = default);

    /// <summary>By endpoint, and only this user's — one device signing out must not silence another.</summary>
    Task UnsubscribeAsync(int userId, string endpoint, CancellationToken ct = default);

    /// <summary>
    /// Sends to every device this user has registered. Returns how many were accepted. A device
    /// the push service says is gone (404/410) is deleted here rather than retried forever.
    /// </summary>
    Task<int> SendToUserAsync(int userId, PushPayload payload, CancellationToken ct = default);
}

public class PushService : IPushService
{
    private readonly AppDbContext _db;
    private readonly PushSettings _settings;
    private readonly ILogger<PushService> _logger;

    // The client is stateless and holds an HttpClient; one is enough and re-making it per send is
    // the classic way to exhaust sockets.
    private static readonly WebPushClient Client = new();

    public PushService(AppDbContext db, IOptions<PushSettings> settings, ILogger<PushService> logger)
    {
        _db = db;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<PushStatusDto> GetStatusAsync(int userId, CancellationToken ct = default)
    {
        if (!_settings.IsConfigured) return new PushStatusDto(false, null, 0);
        var count = await _db.PushSubscriptions.CountAsync(s => s.UserId == userId, ct);
        return new PushStatusDto(true, _settings.PublicKey, count);
    }

    public async Task SubscribeAsync(int userId, PushSubscribeRequest request, CancellationToken ct = default)
    {
        if (!_settings.IsConfigured)
            throw new ValidationAppException("إشعارات الجوال غير مفعّلة على السيرفر.");
        if (string.IsNullOrWhiteSpace(request.Endpoint)
            || string.IsNullOrWhiteSpace(request.Keys?.P256dh)
            || string.IsNullOrWhiteSpace(request.Keys?.Auth))
            throw new ValidationAppException("بيانات الاشتراك ناقصة.");

        // The same browser re-subscribing hands back the SAME endpoint. Updating rather than
        // inserting is what keeps one phone from being told the same thing three times — and it
        // reassigns the device when a different person signs in on it, which is the point.
        var existing = await _db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == request.Endpoint, ct);
        if (existing is not null)
        {
            existing.UserId = userId;
            existing.P256dh = request.Keys.P256dh;
            existing.Auth = request.Keys.Auth;
            existing.UserAgent = Truncate(request.UserAgent, 300);
            // A device that has just re-registered has not been told today's alerts under this
            // account yet, so it is eligible again.
            existing.LastDailyOn = null;
        }
        else
        {
            _db.PushSubscriptions.Add(new Entity.PushSubscription
            {
                UserId = userId,
                Endpoint = request.Endpoint,
                P256dh = request.Keys.P256dh,
                Auth = request.Keys.Auth,
                UserAgent = Truncate(request.UserAgent, 300),
                CreatedAt = DateTimeOffset.UtcNow
            });
        }

        await _db.SaveChangesAsync(ct);
    }

    public async Task UnsubscribeAsync(int userId, string endpoint, CancellationToken ct = default)
    {
        var rows = await _db.PushSubscriptions
            .Where(s => s.UserId == userId && s.Endpoint == endpoint)
            .ToListAsync(ct);
        if (rows.Count == 0) return;
        _db.PushSubscriptions.RemoveRange(rows);
        await _db.SaveChangesAsync(ct);
    }

    public async Task<int> SendToUserAsync(int userId, PushPayload payload, CancellationToken ct = default)
    {
        if (!_settings.IsConfigured) return 0;
        var devices = await _db.PushSubscriptions.Where(s => s.UserId == userId).ToListAsync(ct);
        return await SendToAsync(devices, payload, ct);
    }

    /// <summary>
    /// The shared send. Takes tracked entities so the caller can stamp LastDailyOn on whatever
    /// actually went out — which is the whole defence against telling somebody twice.
    /// </summary>
    internal async Task<int> SendToAsync(
        IReadOnlyList<Entity.PushSubscription> devices, PushPayload payload, CancellationToken ct = default)
    {
        if (!_settings.IsConfigured || devices.Count == 0) return 0;

        var vapid = new VapidDetails(_settings.Subject, _settings.PublicKey, _settings.PrivateKey);
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var sent = 0;
        var dead = new List<Entity.PushSubscription>();

        foreach (var device in devices)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await Client.SendNotificationAsync(
                    new WebPush.PushSubscription(device.Endpoint, device.P256dh, device.Auth), json, vapid, ct);
                device.LastSentAt = DateTimeOffset.UtcNow;
                sent++;
            }
            catch (WebPushException ex) when (
                ex.StatusCode == HttpStatusCode.NotFound || ex.StatusCode == HttpStatusCode.Gone)
            {
                // The push service saying the subscription no longer exists. Apple does this to a
                // web app that has gone unopened for a while, and to any app removed from the home
                // screen. Keeping the row would mean failing this send every morning forever.
                dead.Add(device);
            }
            catch (Exception ex)
            {
                // Everything else is this morning's problem, not this device's: a network blip, a
                // push service having a bad day. Logged and left alone.
                _logger.LogWarning(ex, "Push to one device failed (user {UserId}).", device.UserId);
            }
        }

        if (dead.Count > 0) _db.PushSubscriptions.RemoveRange(dead);
        if (sent > 0 || dead.Count > 0) await _db.SaveChangesAsync(ct);
        return sent;
    }

    // camelCase because the receiving end is a service worker reading event.data.json().
    private static readonly JsonSerializerOptions JsonOptions =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Length <= max ? value : value[..max];
}
