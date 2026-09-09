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
}
