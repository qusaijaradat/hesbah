namespace GreenMarket.Domain.Services;

/// <summary>
/// Requirement doc §6 — "recording payments and linking them to accounts, with the
/// ability to display an account statement." Works for both sides: feed it a farmer's
/// (sale, +netDue)/(payment, -amount) entries, or a merchant's (invoice, +total)/(payment, -amount)
/// entries, and it returns a running balance in chronological order.
/// </summary>
public static class AccountStatementBuilder
{
    public readonly record struct Entry(DateTimeOffset Date, string Description, decimal SignedAmount);
    public readonly record struct StatementLine(DateTimeOffset Date, string Description, decimal SignedAmount, decimal RunningBalance);

    /// <summary>
    /// Positive SignedAmount = increases what's owed to/by the partner; negative = a payment reducing it.
    /// The final line's RunningBalance is the "remaining" figure requirement doc §6/§8 wants on every report.
    /// </summary>
    public static IReadOnlyList<StatementLine> Build(IEnumerable<Entry> entries)
    {
        var ordered = entries.OrderBy(e => e.Date).ToList();
        var lines = new List<StatementLine>(ordered.Count);
        decimal running = 0m;

        foreach (var entry in ordered)
        {
            running += entry.SignedAmount;
            lines.Add(new StatementLine(entry.Date, entry.Description, entry.SignedAmount, running));
        }

        return lines;
    }

    public static decimal RunningBalance(IEnumerable<Entry> entries) =>
        entries.Sum(e => e.SignedAmount);
}
