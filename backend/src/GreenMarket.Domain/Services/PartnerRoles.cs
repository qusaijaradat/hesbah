using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Services;

/// <summary>
/// The one place that decides whether a person is a seller, a buyer or a driver — and the one place
/// that combines those roles when they turn out to be more than one.
///
/// This exists because of a bug that lost people's roles. <see cref="PartnerType"/> could express
/// seller+buyer ("Both") and nothing else, and the find-or-create behind every invoice reacted to a
/// name that already existed by setting the type to Both — whatever the two roles actually were. So
/// typing a new driver's name into an invoice's driver field, when someone with that name was
/// already a buyer, saved him as "بائع/مشتري" and dropped the driver role entirely. Worse, the
/// invoice was still written with his id in DriverId, so the record said he drove it while his own
/// type denied he was a driver — and the next invoice rejected him from the driver field outright,
/// with the picker no longer offering his name at all.
///
/// The roles are bits (see PartnerType), so having a role is a bitwise test and gaining one is a
/// bitwise OR. Nothing here ever REMOVES a role: a person who has ever been a driver stays one.
///
/// Every membership test in the app goes through here. They were written out by hand in ten places —
/// "p.Type is Farmer or Driver or Both", "actual is Merchant or Both", and so on — which is the same
/// shape as every money bug this codebase has had: a rule copied instead of called, so adding the
/// two missing combinations would have meant finding all ten and would have missed some.
/// </summary>
public static class PartnerRoles
{
    /// <summary>
    /// Does this person hold <paramref name="role"/>? A person with no type set at all does NOT —
    /// use <see cref="CanBe"/> for the question "may they be used as one".
    /// </summary>
    public static bool Has(PartnerType? type, PartnerType role) =>
        type is not null && (type.Value & role) == role;

    /// <summary>
    /// May this person be used as <paramref name="role"/> on an invoice or a payment? Same as
    /// <see cref="Has"/>, except a person with no type recorded is allowed anything — an old row
    /// from before types were required must not become unusable.
    /// </summary>
    public static bool CanBe(PartnerType? type, PartnerType role) =>
        type is null || Has(type, role);

    /// <summary>
    /// The person's type after they turn out to also be <paramref name="role"/>. Purely additive:
    /// a buyer who drives becomes buyer+driver, not "Both", and never stops being either.
    /// </summary>
    public static PartnerType Add(PartnerType? type, PartnerType role) =>
        type is null ? role : type.Value | role;

    /// <summary>
    /// Has the money side of a seller or a driver — both post to the same ledger
    /// (FarmerTransaction), so both are asked the same question wherever balances are summed.
    /// </summary>
    public static bool HasSellerSide(PartnerType? type) =>
        Has(type, PartnerType.Farmer) || Has(type, PartnerType.Driver);

    /// <summary>What to call this person in Arabic. A single role reads as itself; more than one
    /// is joined, so "بائع/سائق" is visible rather than one role hidden behind the other.</summary>
    public static string Label(PartnerType? type)
    {
        if (type is null) return "—";
        var parts = new List<string>(3);
        if (Has(type, PartnerType.Farmer)) parts.Add("بائع");
        if (Has(type, PartnerType.Merchant)) parts.Add("مشتري");
        if (Has(type, PartnerType.Driver)) parts.Add("سائق");
        return parts.Count > 0 ? string.Join("/", parts) : "—";
    }
}
