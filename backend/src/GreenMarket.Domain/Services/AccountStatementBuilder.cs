namespace GreenMarket.Domain.Services;

/// <summary>
/// Requirement doc §6 — "recording payments and linking them to accounts, with the
/// ability to display an account statement." Works for both sides: feed it a farmer's
/// (sale, +netDue)/(payment, -amount) entries, or a merchant's (invoice, +total)/(payment, -amount)
/// entries, and it returns a running balance in chronological order.
/// </summary>
public static class AccountStatementBuilder
{
    /// <summary>
    /// The optional fields let a caller attach whatever detail is relevant to THIS kind of line —
    /// an invoice to link to, a Sale row's value/commission split, a payment's method — without the
    /// two very different callers (merchant invoices/payments vs. farmer sales/transport-fees/
    /// payments/adjustments) needing a shared shape for everything. Left null when not applicable.
    /// </summary>
    public readonly record struct Entry(
        DateTimeOffset Date, string Description, decimal SignedAmount,
        int? InvoiceId = null, string? InvoiceNumber = null,
        decimal? SaleValue = null, decimal? Commission = null,
        string? Method = null, string? Notes = null);

    public readonly record struct StatementLine(
        DateTimeOffset Date, string Description, decimal SignedAmount, decimal RunningBalance,
        int? InvoiceId, string? InvoiceNumber,
        decimal? SaleValue, decimal? Commission,
        string? Method, string? Notes);

    /// <summary>
    /// Positive SignedAmount = increases what's owed to/by the partner; negative = a payment reducing it.
    /// The final line's RunningBalance is the "remaining" figure requirement doc §6/§8 wants on every report.
    /// <paramref name="startingBalance"/> seeds the running total before the first entry — this is
    /// how a partner's manually-entered "الرصيد الافتتاحي" (Partner.OpeningBalance) flows into the
    /// statement's running balance without needing a synthetic row of its own; 0 (the default)
    /// reproduces the old no-opening-balance behavior exactly.
    /// </summary>
    public static IReadOnlyList<StatementLine> Build(IEnumerable<Entry> entries, decimal startingBalance = 0m)
    {
        var ordered = entries.OrderBy(e => e.Date).ToList();
        var lines = new List<StatementLine>(ordered.Count);
        decimal running = startingBalance;

        foreach (var entry in ordered)
        {
            running += entry.SignedAmount;
            lines.Add(new StatementLine(
                entry.Date, entry.Description, entry.SignedAmount, running,
                entry.InvoiceId, entry.InvoiceNumber, entry.SaleValue, entry.Commission, entry.Method, entry.Notes));
        }

        return lines;
    }

    public static decimal RunningBalance(IEnumerable<Entry> entries) =>
        entries.Sum(e => e.SignedAmount);
}
