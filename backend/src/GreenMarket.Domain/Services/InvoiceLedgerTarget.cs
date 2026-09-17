namespace GreenMarket.Domain.Services;

/// <summary>
/// Who the market owes for the produce on an invoice — the seller, or the driver who brought it.
///
/// The market changed how it settles, and this is the whole of that change in one place.
///
/// A driver arrives with one load carrying produce for SEVERAL sellers. The market used to pay each
/// of those sellers separately and pay the driver his haulage on top; now it hands the driver one
/// amount for the lot, and the driver distributes it — giving each seller his produce less his
/// commission less his own transport, and keeping what is left, which is precisely the transport
/// and the crate money.
///
/// The market's outlay does not change. It pays exactly what it paid before, to one person instead
/// of several:
///
///     driver gets   Σ(value − commission − transport)  +  transport  +  crate fee
///                 = value − commission + crate fee                   ← the same total as before
///
/// Two cases keep the money on the seller, and they are the same case: there is no outside driver
/// to hand it to.
///   • the driver field is empty;
///   • the driver IS the market — entered under its own name ("المصلحة") because the market's own
///     vehicle brought the load. The market cannot owe itself haulage, so nothing posts to that
///     side at all.
/// </summary>
public static class InvoiceLedgerTarget
{
    /// <summary>
    /// Whose ledger the produce money posts to, or null when the invoice names nobody to pay —
    /// no seller and no outside driver, which is a buyer-only invoice and posts nothing.
    /// </summary>
    /// <param name="farmerId">The invoice's seller, if it has one.</param>
    /// <param name="driverId">The invoice's driver, if it has one.</param>
    /// <param name="houseDriverId">
    /// The partner record standing for the market itself — see <see cref="IsHouse"/>. Null when the
    /// market has not identified one, in which case every named driver counts as an outside driver.
    /// </param>
    public static int? SaleGoesTo(int? farmerId, int? driverId, int? houseDriverId) =>
        IsOutsideDriver(driverId, houseDriverId) ? driverId : farmerId;

    /// <summary>
    /// Does this invoice owe an outside driver his haulage and crate money?
    ///
    /// The same question as above, asked the other way round, and deliberately the same expression:
    /// the two answers have to move together. If the produce money went to a driver but the
    /// haulage did not, the driver would be paid for the load and not for hauling it — and the
    /// difference would sit nowhere, which is how a balance stops adding up.
    /// </summary>
    public static bool IsOutsideDriver(int? driverId, int? houseDriverId) =>
        driverId is not null && !IsHouse(driverId, houseDriverId);

    /// <summary>
    /// Is this the market's own driver record?
    ///
    /// By id, not by name. The market enters it under the name "المصلحة", and matching on that
    /// string would move real money the day somebody renames the record, types it with a different
    /// alef, or registers a genuine driver who happens to be called that. The id is set once, in
    /// settings, and means exactly one row.
    /// </summary>
    public static bool IsHouse(int? driverId, int? houseDriverId) =>
        driverId is not null && houseDriverId is not null && driverId == houseDriverId;
}
