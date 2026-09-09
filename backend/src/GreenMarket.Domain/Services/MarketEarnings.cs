namespace GreenMarket.Domain.Services;

/// <summary>
/// The one place that decides what the MARKET itself earns on an invoice.
///
/// Counterpart to <see cref="InvoiceCharge"/> (what the buyer pays). Both the daily closing and
/// the market report used to answer this with "commission − expenses", which quietly left out
/// every other margin the market actually keeps or pays — most of all the crate fees, which on a
/// forty-box invoice are worth more than they sound and were invisible on the day's profit.
///
/// Derived from the three sides rather than guessed at. With C = commission, T = transport fee,
/// W = wood total, BF = box fee charged to the buyer, DBF = crate handling paid to the driver,
/// R = returned value and Cr = the commission that was charged on R:
///
///   buyer pays   = TV + T + W + BF − R
///   seller is due= TV − C − (R − Cr)      (the return posts −(R − Cr) to their ledger)
///   driver is due= T + DBF + W            (when a driver is attached)
///
/// so what is left with the market is  C − Cr + BF − DBF.
///
/// When NO driver is attached, there is nobody to hand T and W to, so the market keeps both —
/// which is real income, and worth seeing rather than hiding: a driver missing from an invoice is
/// usually a data-entry slip, and this makes it show up as money instead of vanishing.
/// </summary>
public static class MarketEarnings
{
    /// <summary>
    /// What the market keeps from one invoice, before returns and before expenses.
    /// <paramref name="hasDriver"/> decides the transport/crate side: with a driver, transport and
    /// wood are collected and paid straight back out (netting to nothing) and the crate handling
    /// fee is a real cost; with no driver, nothing is paid out and both are kept.
    /// </summary>
    public static decimal ForInvoice(
        decimal commission,
        decimal boxFeeTotal,
        decimal driverBoxFeeTotal,
        decimal transportFee,
        decimal woodTotal,
        bool hasDriver) =>
        commission + boxFeeTotal + (hasDriver ? -driverBoxFeeTotal : transportFee + woodTotal);

    /// <summary>
    /// What a goods return takes back off the market: the commission it had charged on those
    /// goods. Not the whole returned value — that comes off the buyer's bill and the seller's due
    /// in equal measure, so it nets out of the market's own share entirely (see the derivation
    /// above), leaving only the commission it had earned on goods that did not really sell.
    /// </summary>
    public static decimal CommissionCreditOnReturn(decimal returnedValue, decimal commissionRateApplied) =>
        CommissionCalculator.Calculate(returnedValue, commissionRateApplied).Commission;
}
