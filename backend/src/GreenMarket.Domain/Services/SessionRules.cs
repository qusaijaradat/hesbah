namespace GreenMarket.Domain.Services;

/// <summary>
/// When a signed-in device is still signed in, and what to do when a retired token comes back.
///
/// Here rather than in the service that queries the table, for the reason every rule in this
/// project is here: it is the half that can be wrong in a way nothing crashes over. A session that
/// stays usable one minute past being revoked is an admin pressing "سكّر الجلسة" and nothing
/// happening — and that is only ever noticed by the person it was supposed to stop.
/// </summary>
public static class SessionRules
{
    /// <summary>
    /// Is this session still good? Revoked is final, and an expiry is only checked when one was
    /// set — the market's sessions do not expire, they are ended.
    /// </summary>
    public static bool IsUsable(DateTimeOffset? revokedAt, DateTimeOffset? expiresAt, DateTimeOffset now) =>
        revokedAt is null && (expiresAt is null || expiresAt > now);

    /// <summary>
    /// What a presented refresh token means for this session.
    ///
    /// The order matters. A revoked session refuses everything, including the token it last
    /// issued. And a token matching the PREVIOUS hash is checked before anything else can accept
    /// it: that is the theft signal, and treating it as merely "not current" would let the thief
    /// keep trying.
    /// </summary>
    public static RefreshVerdict Verify(
        string presentedHash,
        string currentHash,
        string? previousHash,
        DateTimeOffset? revokedAt,
        DateTimeOffset? expiresAt,
        DateTimeOffset now)
    {
        if (!IsUsable(revokedAt, expiresAt, now)) return RefreshVerdict.Rejected;

        // Two parties hold this session. Which one is asking cannot be known, so neither keeps it.
        if (previousHash is not null && FixedTimeEquals(presentedHash, previousHash))
            return RefreshVerdict.Reused;

        return FixedTimeEquals(presentedHash, currentHash) ? RefreshVerdict.Accepted : RefreshVerdict.Rejected;
    }

    /// <summary>
    /// Constant-time comparison. These are hashes of a live credential, and a comparison that
    /// returns early on the first differing character answers "how much of this did I get right",
    /// one character at a time.
    /// </summary>
    public static bool FixedTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        var diff = 0;
        for (var i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}

public enum RefreshVerdict
{
    /// <summary>Mint a new token, retire this one, let them through.</summary>
    Accepted,

    /// <summary>Not this session's token, or the session is over. Send them to the login screen.</summary>
    Rejected,

    /// <summary>A retired token came back. Kill the session — see UserSession.PreviousTokenHash.</summary>
    Reused
}
