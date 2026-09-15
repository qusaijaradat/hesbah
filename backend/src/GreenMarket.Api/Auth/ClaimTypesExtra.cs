namespace GreenMarket.Api.Auth;

/// <summary>Custom JWT claim types used alongside the standard ones (sub, name).</summary>
public static class ClaimTypesExtra
{
    public const string UserId = "gm_uid";
    public const string RoleName = "gm_role";

    /// <summary>One claim per granted permission key (requirement doc §2 screen/action-level permissions).</summary>
    public const string Permission = "gm_perm";

    /// <summary>
    /// Which signed-in device this token was minted for (UserSession.Id).
    ///
    /// It is what lets a session be ENDED. A signed token cannot be recalled, so without this an
    /// admin pressing "سكّر الجلسة" would only stop the device once its access token lapsed —
    /// hours later, and silently. With it, LiveUserStateMiddleware checks the row on the device's
    /// very next request.
    /// </summary>
    public const string SessionId = "gm_sid";
}
