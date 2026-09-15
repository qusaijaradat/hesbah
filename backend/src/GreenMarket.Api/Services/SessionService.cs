using System.Security.Cryptography;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// Signed-in devices: minting them, rotating them, and ending them.
///
/// The market's decision, and everything here follows from it: an account stays signed in until
/// somebody ends the session. Not until a token expires — a person entering invoices all day
/// should never meet the login screen, and a token that lapses mid-form takes the form with it.
///
/// What makes that safe is that the session is a ROW, and a row can be recalled where a signed
/// token cannot. An admin ending a session stops that device on its very next request, because
/// LiveUserStateMiddleware checks this table on every request just as it already re-reads the
/// user. Nothing waits for a clock.
///
/// The token is never stored — only a SHA-256 of it. This table is read by an admin looking at
/// somebody's devices, and a list of live credentials is not a thing to put on a screen.
/// </summary>
public interface ISessionService
{
    /// <summary>
    /// Opens a session for a device. Returns its id — which the access token carries, so the
    /// session can be ended — and the raw refresh token, which is the only time that value exists
    /// anywhere but the device about to receive it.
    /// </summary>
    Task<(int SessionId, string Token)> StartAsync(int userId, string? userAgent, CancellationToken ct = default);

    /// <summary>
    /// Trades a refresh token for the next one. Returns the session it belongs to, or null when
    /// the token is not good — including the case where it was already retired, which kills the
    /// session before returning (see SessionRules.Verify).
    /// </summary>
    Task<(UserSession Session, string NewToken)?> RotateAsync(string token, CancellationToken ct = default);

    /// <summary>Is this session still live? Asked once per authenticated request.</summary>
    Task<bool> IsLiveAsync(int sessionId, CancellationToken ct = default);

    Task EndAsync(string token, string reason, int? byUserId, CancellationToken ct = default);
    Task EndByIdAsync(int sessionId, string reason, int? byUserId, CancellationToken ct = default);

    /// <summary>Every session a user has. Used when a password changes, and by the admin button
    /// that puts somebody out of everything at once.</summary>
    Task<int> EndAllForUserAsync(int userId, string reason, int? byUserId, CancellationToken ct = default);

    Task<IReadOnlyList<SessionDto>> ListForUserAsync(int userId, CancellationToken ct = default);
}

public class SessionService : ISessionService
{
    private readonly AppDbContext _db;
    private readonly ILogger<SessionService> _logger;

    public SessionService(AppDbContext db, ILogger<SessionService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<(int SessionId, string Token)> StartAsync(int userId, string? userAgent, CancellationToken ct = default)
    {
        var token = NewToken();
        var now = DateTimeOffset.UtcNow;
        var session = new UserSession
        {
            UserId = userId,
            TokenHash = Hash(token),
            CreatedAt = now,
            LastUsedAt = now,
            // Null: the session ends when somebody ends it. See the note at the top.
            ExpiresAt = null,
            UserAgent = Truncate(userAgent, 300)
        };
        _db.UserSessions.Add(session);
        await _db.SaveChangesAsync(ct);
        return (session.Id, token);
    }

    public async Task<(UserSession Session, string NewToken)?> RotateAsync(string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var hash = Hash(token);

        // Either column can match: the current token (an ordinary refresh) or the retired one
        // (somebody replaying a token that has already been spent).
        var session = await _db.UserSessions
            .SingleOrDefaultAsync(s => s.TokenHash == hash || s.PreviousTokenHash == hash, ct);
        if (session is null) return null;

        var now = DateTimeOffset.UtcNow;
        var verdict = SessionRules.Verify(
            hash, session.TokenHash, session.PreviousTokenHash, session.RevokedAt, session.ExpiresAt, now);

        if (verdict == RefreshVerdict.Reused)
        {
            // Two parties hold this session and there is no way to tell which one is asking. The
            // real person signs in again; whoever copied the token cannot.
            session.RevokedAt = now;
            session.RevokedReason = SessionRevokeReason.TokenReused;
            await _db.SaveChangesAsync(ct);
            _logger.LogWarning(
                "A retired refresh token was replayed for session {SessionId} (user {UserId}) — session ended.",
                session.Id, session.UserId);
            return null;
        }

        if (verdict != RefreshVerdict.Accepted) return null;

        var next = NewToken();
        session.PreviousTokenHash = session.TokenHash;
        session.TokenHash = Hash(next);
        session.LastUsedAt = now;
        await _db.SaveChangesAsync(ct);
        return (session, next);
    }

    public async Task<bool> IsLiveAsync(int sessionId, CancellationToken ct = default)
    {
        var row = await _db.UserSessions.AsNoTracking()
            .Where(s => s.Id == sessionId)
            .Select(s => new { s.RevokedAt, s.ExpiresAt })
            .SingleOrDefaultAsync(ct);
        return row is not null && SessionRules.IsUsable(row.RevokedAt, row.ExpiresAt, DateTimeOffset.UtcNow);
    }

    public async Task EndAsync(string token, string reason, int? byUserId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return;
        var hash = Hash(token);
        var session = await _db.UserSessions
            .SingleOrDefaultAsync(s => s.TokenHash == hash || s.PreviousTokenHash == hash, ct);
        if (session is null || session.RevokedAt is not null) return;
        Revoke(session, reason, byUserId);
        await _db.SaveChangesAsync(ct);
    }

    public async Task EndByIdAsync(int sessionId, string reason, int? byUserId, CancellationToken ct = default)
    {
        var session = await _db.UserSessions.SingleOrDefaultAsync(s => s.Id == sessionId, ct);
        if (session is null || session.RevokedAt is not null) return;
        Revoke(session, reason, byUserId);
        await _db.SaveChangesAsync(ct);
    }

    public async Task<int> EndAllForUserAsync(int userId, string reason, int? byUserId, CancellationToken ct = default)
    {
        var live = await _db.UserSessions.Where(s => s.UserId == userId && s.RevokedAt == null).ToListAsync(ct);
        foreach (var session in live) Revoke(session, reason, byUserId);
        if (live.Count > 0) await _db.SaveChangesAsync(ct);
        return live.Count;
    }

    public async Task<IReadOnlyList<SessionDto>> ListForUserAsync(int userId, CancellationToken ct = default)
    {
        // Live ones first, newest first. Ended ones are kept and shown because "when did that phone
        // stop working" is the question somebody asks after the fact, and an empty list cannot
        // answer it.
        return await _db.UserSessions.AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderBy(s => s.RevokedAt == null ? 0 : 1)
            .ThenByDescending(s => s.LastUsedAt)
            .Select(s => new SessionDto(
                s.Id, s.UserAgent, s.CreatedAt, s.LastUsedAt, s.RevokedAt, s.RevokedReason))
            .ToListAsync(ct);
    }

    private static void Revoke(UserSession session, string reason, int? byUserId)
    {
        session.RevokedAt = DateTimeOffset.UtcNow;
        session.RevokedReason = reason;
        session.RevokedByUserId = byUserId;
    }

    /// <summary>256 bits from the OS, base64url so it survives a cookie without escaping.</summary>
    private static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    private static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Length <= max ? value : value[..max];
}
