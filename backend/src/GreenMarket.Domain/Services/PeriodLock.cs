namespace GreenMarket.Domain.Services;

/// <summary>
/// Which months are closed, and therefore may no longer be written to.
///
/// A statement is printed, the man is paid against it, and the month is over. Until now nothing in
/// the system said so: anyone with edit rights could open an invoice from that month and change a
/// weight, and the figure the market already settled on would move — with no sign on the screen
/// that the paper in somebody's pocket no longer matched the books. The daily close is a report,
/// not a lock; it summarises the day and prevents nothing.
///
/// The unit is the MONTH, because that is the unit the market settles in. Nobody closes a period
/// ending the 14th, so a rule that allowed it would only be a way to get the boundary wrong.
///
/// Two ways a month closes:
///
///  * Somebody closes it, having finished the accounts for it.
///  * It closes on its own, once it has been over for a set number of days — the grace period, the
///    span in which corrections to last month are still ordinary work. That is what makes this
///    hold in practice: a lock that depends on a person remembering to press a button every month
///    is a lock that is open most of the year.
///
/// Reopening is deliberately awkward and deliberately temporary: it steps the lock back one month
/// and holds the automatic close off for a few days, so a month that was opened to fix one row
/// does not quietly stay open until somebody notices in March.
///
/// Nothing here reads the clock or the database — the caller passes both — so the rule can be
/// tested against any date, and the same rule answers the screen, the guard and the report.
/// </summary>
public static class PeriodLock
{
    /// <summary>How a closed month is stored and shown: "2026-08" — the whole of August 2026.</summary>
    public const string MonthFormat = "yyyy-MM";

    /// <summary>
    /// Days after a month ends before it closes by itself. The default the market starts with;
    /// the setting can raise it, and zero turns the automatic close off entirely.
    ///
    /// Ten because the market settles the month in the first week of the next one, and a lock that
    /// lands before that work is finished is a lock people learn to route around.
    /// </summary>
    public const int DefaultGraceDays = 10;

    /// <summary>Days the automatic close stands down after a month is reopened — long enough to
    /// finish the correction that justified opening it, short enough that forgetting costs nothing.</summary>
    public const int ReopenHoldDays = 3;

    /// <summary>The first day of a stored month, or null for "nothing is closed" — which is what a
    /// blank, a missing key and anything unparseable all mean. An unreadable value must not be read
    /// as a lock: a lock nobody set would block real work with no way on screen to explain itself.</summary>
    public static DateOnly? ParseMonth(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        var parts = stored.Trim().Split('-');
        if (parts.Length != 2) return null;
        if (!int.TryParse(parts[0], out var year) || year < 2000 || year > 2999) return null;
        if (!int.TryParse(parts[1], out var month) || month < 1 || month > 12) return null;
        return new DateOnly(year, month, 1);
    }

    /// <summary>The stored form of a month. Takes any day in it.</summary>
    public static string FormatMonth(DateOnly anyDayIn) =>
        $"{anyDayIn.Year:0000}-{anyDayIn.Month:00}";

    /// <summary>The last day of the month a date falls in.</summary>
    public static DateOnly EndOfMonth(DateOnly anyDayIn) =>
        new(anyDayIn.Year, anyDayIn.Month, DateTime.DaysInMonth(anyDayIn.Year, anyDayIn.Month));

    /// <summary>The last day covered by a lock — everything on or before it is closed.</summary>
    public static DateOnly? ClosedThrough(string? lockedThroughMonth)
    {
        var month = ParseMonth(lockedThroughMonth);
        return month is null ? null : EndOfMonth(month.Value);
    }

    /// <summary>
    /// Whether a record carrying this date may no longer be written.
    ///
    /// Asked of the date ON THE RECORD, never of the clock: what closes a row is the month it
    /// belongs to, and a payment entered today for the 20th of a closed month is exactly the write
    /// this exists to stop.
    /// </summary>
    public static bool Blocks(DateTimeOffset when, string? lockedThroughMonth)
    {
        var closedThrough = ClosedThrough(lockedThroughMonth);
        return closedThrough is not null && DateOnly.FromDateTime(when.Date) <= closedThrough.Value;
    }

    /// <summary>The month before the one <paramref name="today"/> falls in.</summary>
    public static DateOnly PreviousMonth(DateOnly today) =>
        new DateOnly(today.Year, today.Month, 1).AddMonths(-1);

    /// <summary>
    /// The month the automatic close should have reached by <paramref name="today"/>, or the
    /// current lock unchanged when it should not move.
    ///
    /// It only ever moves FORWARD. Lowering the grace period, or a clock that comes back wrong
    /// after a restore, must not reopen a month that was closed — reopening is a decision somebody
    /// makes, not something a subtraction does.
    ///
    /// And it never starts on its own. With nothing closed yet it stays that way, because the
    /// alternative is a system that silently refuses edits to months nobody was told about, on the
    /// day it was installed, to a market with a year of history in it. The first close is a
    /// decision somebody makes; from then on this keeps up with it.
    /// </summary>
    /// <param name="lockedThroughMonth">What is closed now.</param>
    /// <param name="today">The market's own date.</param>
    /// <param name="graceDays">Days after month end before it closes. Zero or less: off.</param>
    /// <param name="holdUntil">Set by a reopen; while it is in the future nothing closes by itself.</param>
    public static string? AutoTarget(string? lockedThroughMonth, DateOnly today, int graceDays, DateOnly? holdUntil)
    {
        var current = ParseMonth(lockedThroughMonth);
        if (current is null) return null;
        var currentStored = FormatMonth(current.Value);
        if (graceDays <= 0) return currentStored;
        if (holdUntil is not null && holdUntil.Value >= today) return currentStored;

        // Walk back from last month until one has been over long enough. Usually the first try.
        var candidate = PreviousMonth(today);
        while (EndOfMonth(candidate).AddDays(graceDays) > today)
        {
            candidate = candidate.AddMonths(-1);
            // Far enough back that no grace period anyone would set can reach: give up rather than
            // loop, and leave the lock where it is.
            if (candidate.Year < today.Year - 2) return currentStored;
        }

        return candidate <= current.Value ? currentStored : FormatMonth(candidate);
    }

    /// <summary>
    /// What a reopen leaves behind: the month before the one currently closed, or nothing closed at
    /// all when only one month was. Stepping back exactly one is the point — reopening is for
    /// correcting the month just settled, and an unlock that opened the whole history would be a
    /// bigger hole than the one this closes.
    /// </summary>
    public static string? AfterReopen(string? lockedThroughMonth)
    {
        var current = ParseMonth(lockedThroughMonth);
        if (current is null) return null;
        var previous = current.Value.AddMonths(-1);
        return FormatMonth(previous);
    }
}
