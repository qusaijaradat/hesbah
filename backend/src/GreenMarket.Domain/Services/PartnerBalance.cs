namespace GreenMarket.Domain.Services;

/// <summary>
/// What a person's two balances ARE — the formula, in one place, for the first time.
///
/// Each of them was written out by hand in three places: once in the account page's own builder,
/// once in the bulk-aggregated version behind the partners list, and once again behind "قيمة
/// الديون". All three agreed, and the comments on them said so — "same Remaining formulas as
/// GetFarmerAccountAsync" — which is a comment doing the job of a function call, and is exactly
/// the shape of every money bug this system has had.
///
/// They are the same two sums either way. What differs is only how the inputs are fetched: one
/// partner at a time with a full statement behind it, or one grouped query across a page of them.
/// That difference belongs in the query, not in the arithmetic.
/// </summary>
public static class PartnerBalance
{
    /// <summary>
    /// What a BUYER owes the market. Positive means he owes it.
    ///
    /// His opening balance, plus everything he has bought on active invoices, minus what he has
    /// actually paid — where "actually" is PaymentRules' business: a check that has not cleared is
    /// not money yet, and a bounced one never was.
    /// </summary>
    public static decimal ForBuyer(decimal openingBalance, decimal activeInvoiceTotal, decimal clearedPayments) =>
        openingBalance + activeInvoiceTotal - clearedPayments;

    /// <summary>
    /// What the market owes a SELLER or a DRIVER. Positive means the market owes them.
    ///
    /// Opening balance plus the net of their own ledger — and the NET, not (dues − payments),
    /// because the ledger also carries adjustments: the reversal posted when an invoice is
    /// cancelled, and the manual تسوية somebody types on an account. Summing every row's own
    /// already-signed amount is the same thing AccountStatementBuilder does internally, which is
    /// what keeps the headline figure and the statement's last line from ever disagreeing.
    /// </summary>
    public static decimal ForSeller(decimal openingBalance, decimal ledgerNet) =>
        openingBalance + ledgerNet;
}
