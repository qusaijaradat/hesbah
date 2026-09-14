namespace GreenMarket.Api.Services;

/// <summary>
/// VAPID — the keypair that identifies THIS server to Apple's, Google's and Mozilla's push
/// services. Generated once, kept forever: the public half is baked into every subscription a
/// phone creates, so rotating the private key does not re-key those subscriptions, it orphans
/// them. Every device would have to turn notifications on again, and nobody would be told to.
///
/// Absent configuration is not an error. The whole feature reports itself as off — the settings
/// screen says so instead of offering a switch that cannot work — because a market running this
/// without notifications is the normal case, not a broken deployment.
/// </summary>
public class PushSettings
{
    public const string SectionName = "Push";

    /// <summary>Base64url, ~87 chars. Handed to the browser, which needs it to subscribe.</summary>
    public string PublicKey { get; set; } = string.Empty;

    /// <summary>Base64url, ~43 chars. A secret: it is what proves a push came from this server.</summary>
    public string PrivateKey { get; set; } = string.Empty;

    /// <summary>
    /// Who to contact about this application — "mailto:..." or a URL. Required by the VAPID spec
    /// so a push service has a way to reach an operator whose server is misbehaving; some of them
    /// reject a push without it.
    /// </summary>
    public string Subject { get; set; } = string.Empty;

    /// <summary>
    /// The local hour the day's alerts go out. Seven in the morning: a market is already working
    /// by then, and a notification about a check due TODAY has to arrive while the day can still
    /// be used.
    /// </summary>
    public int DailyHour { get; set; } = 7;

    /// <summary>
    /// The market's own clock, as an IANA id ("Asia/Hebron"). A container runs on UTC and
    /// Palestine is two or three hours ahead of it depending on the season, so left empty
    /// <see cref="DailyHour"/> would mean seven o'clock somewhere nobody is standing.
    /// </summary>
    public string TimeZone { get; set; } = string.Empty;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(PublicKey)
        && !string.IsNullOrWhiteSpace(PrivateKey)
        && !string.IsNullOrWhiteSpace(Subject);
}
