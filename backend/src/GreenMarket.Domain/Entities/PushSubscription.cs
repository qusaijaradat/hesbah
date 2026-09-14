namespace GreenMarket.Domain.Entities;

/// <summary>
/// One device that has agreed to receive the alerts banner as a phone notification.
///
/// A registration, not a business record — which is why it is a plain entity like
/// <see cref="Setting"/> rather than an AuditableEntity. Nothing here is money, nothing here is
/// ever reported on, and a row is created and destroyed by a person tapping a switch on their own
/// phone. (It is also skipped by the audit interceptor: a browser re-registering itself is not an
/// edit anybody needs to investigate, and the keys below are not worth copying into a second
/// table that more people can read.)
///
/// Per DEVICE, not per user: the same person signing in on a phone and a tablet gets two rows and
/// is told on both. And per USER, not per browser: the notification is built from what THAT user
/// is allowed to see, so two people sharing a counter phone must not inherit each other's alerts —
/// the subscription is dropped on sign-out for exactly that reason.
/// </summary>
public class PushSubscription
{
    public int Id { get; set; }

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    /// <summary>
    /// The push service's URL for this device — issued by Apple/Google/Mozilla, not by us. It is
    /// the identity of the subscription: the same browser re-subscribing returns the same endpoint,
    /// which is why it is unique here and why re-registering updates rather than duplicates.
    /// </summary>
    public string Endpoint { get; set; } = string.Empty;

    /// <summary>The device's public key, for encrypting the payload TO it. Half of a pair whose
    /// private half never leaves the phone — the push service relays a message it cannot read.</summary>
    public string P256dh { get; set; } = string.Empty;

    /// <summary>The subscription's auth secret, the other half of that encryption.</summary>
    public string Auth { get; set; } = string.Empty;

    /// <summary>What the browser called itself when it subscribed, so a person looking at their
    /// own list of devices can tell the phone from the tablet. Never used for anything else.</summary>
    public string? UserAgent { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// The last time a send to this endpoint was ACCEPTED by the push service. Apple in particular
    /// expires a subscription that has gone quiet, and a 404/410 back from a send is the push
    /// service saying "this device is gone" — those rows are deleted on the spot rather than kept
    /// and retried forever.
    /// </summary>
    public DateTimeOffset? LastSentAt { get; set; }

    /// <summary>
    /// The local date this device was last told the day's alerts. The daily send reads it so a
    /// restart, a second instance, or a clock that crosses the hour twice cannot deliver the same
    /// morning's notification twice — which is the fastest way to teach somebody to swipe the
    /// app's notifications away without reading them.
    /// </summary>
    public DateOnly? LastDailyOn { get; set; }
}
