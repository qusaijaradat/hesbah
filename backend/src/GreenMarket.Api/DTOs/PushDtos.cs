namespace GreenMarket.Api.DTOs;

/// <summary>What the settings screen needs to decide whether to offer the switch at all.</summary>
/// <param name="Enabled">The server has VAPID keys. False means the feature is off everywhere.</param>
/// <param name="PublicKey">The VAPID public key, which the browser needs in order to subscribe.</param>
/// <param name="DeviceCount">How many devices THIS user currently has registered.</param>
/// <param name="ReceivesAny">
/// Whether this user's permissions reach ANY alert at all — asked of the same AlertVisibility the
/// banner and the morning send use, never worked out on a screen.
///
/// It exists so the app can stop short of asking. Prompting somebody to switch on notifications
/// they will never receive is worse than not prompting: they agree, nothing ever arrives, and the
/// next thing the app asks for gets the same answer. The settings switch stays available to them
/// regardless — this only decides whether the app brings it up unprompted.
/// </param>
public record PushStatusDto(bool Enabled, string? PublicKey, int DeviceCount, bool ReceivesAny);

/// <summary>
/// A PushSubscription as the browser's own PushManager hands it over — the shape of
/// <c>subscription.toJSON()</c>, passed through unchanged so there is nothing to get wrong in
/// between.
/// </summary>
public record PushSubscribeRequest(string Endpoint, PushSubscribeKeys Keys, string? UserAgent);

public record PushSubscribeKeys(string P256dh, string Auth);

/// <summary>Unsubscribing names the endpoint, because that is what identifies the device.</summary>
public record PushUnsubscribeRequest(string Endpoint);

/// <summary>
/// One notification, as it goes over the wire to the device. Deliberately small: a title, a line,
/// and where to go when it is tapped. Nothing here is a money figure the phone would then be
/// holding in a notification tray somebody else can read over a shoulder.
/// </summary>
public record PushPayload(string Title, string Body, string Url, string? Tag);
