namespace GreenMarket.Api.DTOs;

/// <summary>
/// Which months are closed to writing, and what happens next.
///
/// Dates are plain "yyyy-MM-dd" strings and the month is "yyyy-MM", because every one of them is a
/// calendar day the market names — not a moment in time. Sending them as timestamps would hand the
/// browser a timezone to shift them by, and a lock that reads as ending the 31st on one phone and
/// the 30th on another is worse than none.
/// </summary>
/// <param name="LockedThroughMonth">The last closed month, "2026-08". Null when nothing is closed.</param>
/// <param name="ClosedThrough">The last closed DAY — the end of that month, spelled out so the
/// screen never has to work it out a second way.</param>
/// <param name="AutoLockDays">Days after a month ends before it closes by itself. Zero means the
/// automatic close is off and closing is left to whoever presses the button.</param>
/// <param name="HoldUntil">While this day has not passed, nothing closes by itself — set when a
/// month is reopened, so the correction has time to happen.</param>
/// <param name="NextMonthToClose">The month due to close next, if any.</param>
/// <param name="NextCloseOn">The day it closes on.</param>
/// <param name="ClosableNow">The newest month that may be closed by hand — last month. Offered so
/// the screen's button and the server's rule cannot name two different months.</param>
public record PeriodLockStatusDto(
    string? LockedThroughMonth,
    string? ClosedThrough,
    int AutoLockDays,
    string? HoldUntil,
    string? NextMonthToClose,
    string? NextCloseOn,
    string ClosableNow);

/// <param name="Month">The month to close, "2026-08".</param>
public record ClosePeriodRequest(string Month);
