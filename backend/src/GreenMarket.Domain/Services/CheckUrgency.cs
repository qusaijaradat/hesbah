namespace GreenMarket.Domain.Services;

/// <summary>
/// When a check counts as overdue, due today, or coming up soon.
///
/// Three separate screens ask this — the top-of-page alerts banner, the dashboard's checks cards,
/// and the الشيكات page's own row highlighting — and a banner that calls a check "فات موعدها" while
/// the page it links to shows it as merely "قريبًا" is worse than no banner at all. So the buckets
/// are defined once, here, the same way <see cref="PaymentRules"/> defines when a check counts as
/// money at all.
///
/// The comparisons run in UTC on purpose. A check's due date is written as
/// <c>new Date("YYYY-MM-DD").toISOString()</c> everywhere it is recorded, and JavaScript parses a
/// date-only string as UTC — so every CheckDueDate in the database sits at exactly T00:00:00Z of
/// its due day. Bucketing against a local midnight instead would shift whole days' worth of checks
/// into the wrong bucket for any market not sitting on UTC.
/// </summary>
public static class CheckUrgency
{
    /// <summary>How far ahead still counts as "قريبًا". Matches the الشيكات page's own amber window.</summary>
    public const int DueSoonDays = 7;

    /// <summary>Midnight UTC of the current day — the reference point every bucket is measured from.</summary>
    public static DateTimeOffset TodayUtc() => new(DateTime.UtcNow.Date, TimeSpan.Zero);

    /// <summary>Its due date has already passed. The one that costs money to miss.</summary>
    public static bool IsOverdue(DateTimeOffset dueDate, DateTimeOffset todayUtc) => dueDate < todayUtc;

    public static bool IsDueToday(DateTimeOffset dueDate, DateTimeOffset todayUtc) =>
        dueDate >= todayUtc && dueDate < todayUtc.AddDays(1);

    /// <summary>Due within the next <see cref="DueSoonDays"/> days, but not today — an early warning,
    /// deliberately exclusive of today so a check is only ever in one bucket.</summary>
    public static bool IsDueSoon(DateTimeOffset dueDate, DateTimeOffset todayUtc) =>
        dueDate >= todayUtc.AddDays(1) && dueDate < todayUtc.AddDays(DueSoonDays + 1);
}
