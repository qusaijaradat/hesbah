namespace GreenMarket.Domain.Services;

/// <summary>
/// The one place that decides what an invoice charges the merchant.
///
/// Before this existed the formula was written out by hand in five places and two of them
/// disagreed: every balance query summed <c>TotalValue</c> alone, while the invoice's own printed
/// "الرصيد السابق" summed the full total — so the wood, transport and box charges were on the
/// paper but missing from every account page, debt overview and merchant report. Same class of
/// problem as the check-clearing rule (see <see cref="PaymentRules"/>), fixed the same way: one
/// definition, called from everywhere, and its result stored on the invoice so a balance is a
/// plain SUM of one column instead of a per-row subquery.
///
/// What's in and what's out:
///   • TotalValue     — the produce itself. Also the commission base, and the only figure the
///                      farmer's own math is ever computed from.
///   • TransportFee is NOT here. أجرة النقل is what it costs the SELLER to get his produce to
///     the market, so it comes off his due and goes to the driver — the buyer is not charged for
///     it at all. It used to sit in this total, which charged the buyer for a journey that
///     happened before he was involved.
///   • woodTotal      — سعر الخشب, charged to the buyer and kept by the MARKET. Neither the
///                      seller nor the driver has a claim on it. It has moved twice: it was once
///                      paid to both of them at the same time, so a single charge went out twice
///                      and the market lost money on any invoice carrying both.
///   • boxFeeTotal    — رسوم الصناديق, charged to the buyer only.
///   • − returnsTotal — قيمة المرتجع, goods the buyer sent back. This DOES
///                      reduce the farmer's due as well (they never sold those goods) — that side
///                      is posted as its own ledger Adjustment, see GoodsReturnService.
/// </summary>
public static class InvoiceCharge
{
    /// <summary>What this invoice charges the buyer.</summary>
    public static decimal ForMerchant(
        decimal totalValue,
        decimal woodTotal,
        decimal boxFeeTotal,
        decimal returnsTotal) =>
        totalValue + woodTotal + boxFeeTotal - returnsTotal;

    /// <summary>
    /// What this invoice owes the SELLER: his produce, less the market's commission, less the
    /// transport that brought it in. Here beside ForMerchant on purpose — the two opposite sides of
    /// one invoice belong in one place, and the five call sites that used to spell this out by hand
    /// are exactly how سعر الخشب ended up on the seller's ledger and the driver's at once.
    ///
    /// Wood and رسوم الصناديق are not in it: neither is the seller's to be paid for. Returns are
    /// not either — those post their own offsetting Adjustment when they happen, rather than being
    /// folded in here where they would apply from the moment the invoice was written.
    /// </summary>
    public static decimal ForSeller(decimal totalValue, decimal commission, decimal transportFee) =>
        totalValue - commission - transportFee;

    /// <summary>
    /// What this invoice owes the DRIVER: the أجرة النقل taken off the seller, plus أجرة الصناديق
    /// for handling the crates — a share of the crate fee the buyer paid, not a charge on top of it.
    /// The third side, here beside the other two for the same reason they are together: it was
    /// spelled out by hand in five places (the ledger row on create, the two on edit, the invoice
    /// list row, the printed copy), and the driver's share of a crate is exactly the kind of rate
    /// that gets changed in one place and missed in four.
    ///
    /// Only meaningful when a driver is attached. With nobody to pay, the transport stays with the
    /// market instead — see <see cref="MarketEarnings.ForInvoice"/>, which owns that decision.
    /// </summary>
    public static decimal ForDriver(decimal transportFee, decimal driverBoxFeeTotal) =>
        transportFee + driverBoxFeeTotal;

    /// <summary>
    /// What this invoice owes ONE PERSON who is both its seller and its driver — his own produce,
    /// which he also hauled in.
    ///
    /// Not a new rule: it is <see cref="ForSeller"/> plus <see cref="ForDriver"/>, and it lives
    /// here so the sum has one home instead of being written out wherever both sides happen to be
    /// on screen together.
    ///
    /// Worth following through, because the printed breakdown looks wrong until you do: أجرة النقل
    /// is SUBTRACTED on the seller side and PAID on the driver side, so for one person holding both
    /// roles it cancels itself out and the result is his produce, less the commission, plus his
    /// أجرة الصناديق. That is correct — the market is not charging him to carry his own goods, and
    /// it is not paying him twice for it either. The two lines still get printed, because a figure
    /// that cancels invisibly is a figure nobody can check.
    /// </summary>
    public static decimal ForSellerDriver(
        decimal totalValue, decimal commission, decimal transportFee, decimal driverBoxFeeTotal) =>
        ForSeller(totalValue, commission, transportFee) + ForDriver(transportFee, driverBoxFeeTotal);
}
