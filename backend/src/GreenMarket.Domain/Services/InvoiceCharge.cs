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
///   • TransportFee   — أجرة النقل, a pass-through the buyer pays and the driver receives.
///   • woodTotal      — سعر الخشب, charged to the buyer AND paid in full to the seller/driver.
///   • boxFeeTotal    — رسوم الصناديق, charged to the buyer only.
///   • − discount     — خصم, the market's own concession; never touches the commission base, so it
///                      comes out of the market's margin rather than the farmer's due.
///   • − returnsTotal — قيمة المرتجع, goods the buyer sent back. Unlike the discount this DOES
///                      reduce the farmer's due as well (they never sold those goods) — that side
///                      is posted as its own ledger Adjustment, see GoodsReturnService.
/// </summary>
public static class InvoiceCharge
{
    public static decimal ForMerchant(
        decimal totalValue,
        decimal transportFee,
        decimal woodTotal,
        decimal boxFeeTotal,
        decimal discount,
        decimal returnsTotal) =>
        totalValue + transportFee + woodTotal + boxFeeTotal - discount - returnsTotal;
}
