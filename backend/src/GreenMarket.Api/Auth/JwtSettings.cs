namespace GreenMarket.Api.Auth;

public class JwtSettings
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = string.Empty;
    public string Audience { get; set; } = string.Empty;
    public string SigningKey { get; set; } = string.Empty;

    /// <summary>
    /// A full working day. Raised from 60 minutes because at that length staff entering invoices
    /// all day were signed out roughly eight times a shift, and there is no refresh token — the
    /// 401 interceptor clears storage and navigates to /login, so an expiry in the middle of a
    /// half-typed invoice took the whole form with it.
    ///
    /// The usual reason to keep an access token short is that it cannot be revoked before it
    /// expires. That reason does not apply here: <see cref="Common.LiveUserStateMiddleware"/>
    /// re-reads the live user record on EVERY request, so deactivating an account, changing its
    /// role's permissions, or setting MustChangePassword takes effect on the user's very next
    /// action no matter how long their token is still nominally valid. What a longer lifetime
    /// actually costs here is a wider window for a token stolen out of browser storage — a real
    /// but much narrower risk than the daily cost it removes for a single-location market.
    ///
    /// Note this only reduces how OFTEN work is lost, not whether it can be: an expiry still
    /// discards whatever is on screen. Not losing the form across a re-login is a separate fix.
    /// </summary>
    public int AccessTokenMinutes { get; set; } = 720;
}
