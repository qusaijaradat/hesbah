namespace GreenMarket.Api.DTOs;

/// <summary>
/// What an alert is about. The backend returns the FACT (which kind, how many, how much); the
/// Arabic wording and the link live in the frontend, alongside every other string the user reads —
/// so adding a kind here doesn't scatter its text across two projects.
/// </summary>
public enum AlertKind
{
    /// <summary>Checks whose due date has passed and are still قيد التحصيل.</summary>
    OverdueChecks = 1,

    /// <summary>Checks coming due today.</summary>
    ChecksDueToday = 2,

    /// <summary>Active invoices carrying at least one line still at price 0.</summary>
    UnpricedInvoices = 3
}

/// <summary>Ordering matters: the banner sorts by this, worst first.</summary>
public enum AlertSeverity
{
    Info = 1,
    Warning = 2,
    Critical = 3
}

/// <summary>
/// One row of the top-of-page banner. <paramref name="Amount"/> is 0 for kinds where a sum is
/// meaningless (an unpriced invoice has no reliable total yet — that is the point of it), and
/// <paramref name="Names"/> is a capped sample so the banner can say WHO without becoming a
/// second copy of the page it links to.
/// </summary>
public record AlertDto(
    AlertKind Kind,
    AlertSeverity Severity,
    int Count,
    decimal Amount,
    IReadOnlyList<string> Names);
