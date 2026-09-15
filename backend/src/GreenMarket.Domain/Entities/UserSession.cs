namespace GreenMarket.Domain.Entities;

/// <summary>
/// One device somebody is signed in on, and the only thing that decides whether they still are.
///
/// The market asked for accounts that stay signed in — a person entering invoices all day should
/// never meet the login screen — and for the admin to be the one who ends a session. Both of those
/// live here: a session has no expiry unless somebody sets one, and it stops the moment a row is
/// revoked, not when a token happens to run out.
///
/// That second half is what makes the first half safe. A signed token cannot be recalled; a row
/// can. <see cref="GreenMarket.Api.Common.LiveUserStateMiddleware"/> already re-reads the live user
/// on every request, so it checks this too — which means "سكّر الجلسة" takes effect on that
/// device's very next action, not in twelve hours.
///
/// The refresh token itself is never stored. Only a SHA-256 of it, because this table is read by
/// more people than it is written by (an admin listing somebody's devices) and a table of live
/// credentials is not a thing to hand around.
/// </summary>
public class UserSession
{
    public int Id { get; set; }

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>SHA-256 of the refresh token currently valid for this device.</summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>
    /// SHA-256 of the token this one replaced, kept for exactly one rotation.
    ///
    /// It is the theft detector. Every refresh mints a new token and retires the old one, so a
    /// retired token being presented means two parties hold this session's credentials — the
    /// person and whoever copied it. There is no way to tell which is which, so the session is
    /// killed and both are sent back to the login screen. That is the intended outcome: the real
    /// person signs in again, and the thief cannot.
    /// </summary>
    public string? PreviousTokenHash { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastUsedAt { get; set; }

    /// <summary>
    /// Null means never — which is the normal case here, by request. A session ends because
    /// somebody ended it, not because a clock ran out.
    /// </summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>
    /// Who ended it — the admin who pressed the button, the person themselves signing out, or null
    /// when the system ended it on its own (a reused token, a changed password). Worth keeping:
    /// "why am I signed out" is a question somebody will ask, and the audit log records the action
    /// but not the intent.
    /// </summary>
    public int? RevokedByUserId { get; set; }

    /// <summary>The reason, as one of <see cref="SessionRevokeReason"/>'s values.</summary>
    public string? RevokedReason { get; set; }

    /// <summary>What the browser called itself, so somebody looking at a list of their own devices
    /// can tell the phone from the counter laptop. Never used for anything else.</summary>
    public string? UserAgent { get; set; }
}

/// <summary>Why a session ended. Strings, because they are shown on screen and stored as text.</summary>
public static class SessionRevokeReason
{
    public const string SignedOut = "SignedOut";
    public const string EndedByAdmin = "EndedByAdmin";
    public const string PasswordChanged = "PasswordChanged";

    /// <summary>A retired refresh token came back — see UserSession.PreviousTokenHash.</summary>
    public const string TokenReused = "TokenReused";
}
