using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IPeriodLockService
{
    /// <summary>What is closed, what closes next, and when — for the settings screen.</summary>
    Task<PeriodLockStatusDto> GetStatusAsync();

    /// <summary>
    /// Refuses the write when the record's own date falls in a closed month.
    ///
    /// Called by every service that writes a dated, money-bearing row. The description is what the
    /// person was doing, in Arabic, so the refusal names the action rather than the table.
    /// </summary>
    Task EnsureOpenAsync(DateTimeOffset when, string what);

    /// <summary>
    /// For a change that moves a record from one date to another: both ends must be open. Moving a
    /// payment OUT of a closed month changes that month's total exactly as much as editing one
    /// inside it does.
    /// </summary>
    Task EnsureOpenAsync(DateTimeOffset before, DateTimeOffset after, string what);

    /// <summary>Closes a month by hand, having finished the accounts for it.</summary>
    Task<PeriodLockStatusDto> CloseAsync(string month, int? userId);

    /// <summary>Steps the lock back one month, and stands the automatic close down for a few days.</summary>
    Task<PeriodLockStatusDto> ReopenAsync(int? userId);
}

/// <summary>
/// Keeps closed months closed. The rules are in Domain.Services.PeriodLock; this reads and writes
/// the three settings they run on, and turns a blocked write into the message the user sees.
///
/// The lock advances LAZILY — the automatic close happens the next time anything asks, not on a
/// timer. A background job would be a second place that decides what is closed, and the two would
/// eventually disagree; here, whatever asks the question also brings the answer up to date.
///
/// The value is read once per request (the service is scoped) so a save that guards three dates
/// does not go to the settings table three times.
/// </summary>
public class PeriodLockService : IPeriodLockService
{
    private readonly AppDbContext _db;
    private string? _cached;
    private bool _read;

    public PeriodLockService(AppDbContext db) => _db = db;

    private static DateOnly Today => DateOnly.FromDateTime(DateTimeOffset.Now.Date);

    private async Task<string?> RawAsync(string key) =>
        (await _db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key))?.Value;

    private async Task<int> GraceDaysAsync()
    {
        var raw = await RawAsync(Setting.Keys.PeriodAutoLockDays);
        if (string.IsNullOrWhiteSpace(raw)) return PeriodLock.DefaultGraceDays;
        // A value nobody can read means nobody meant to turn it off, so keep the default rather
        // than silently leaving every month open.
        return int.TryParse(raw.Trim(), out var days) ? days : PeriodLock.DefaultGraceDays;
    }

    private async Task<DateOnly?> HoldUntilAsync()
    {
        var raw = await RawAsync(Setting.Keys.PeriodAutoLockHoldUntil);
        return DateOnly.TryParse(raw, out var date) ? date : null;
    }

    /// <summary>
    /// The closed-through month, with the automatic close applied.
    ///
    /// Deliberately WRITES NOTHING. The guard runs inside other services' saves, and a settings
    /// write there would commit whatever half-built invoice its caller had tracked. The automatic
    /// close is a calculation, not a record; the stored value is brought up to date only when the
    /// settings screen asks, where nothing else is in flight.
    /// </summary>
    private async Task<string?> CurrentAsync()
    {
        if (_read) return _cached;
        var stored = await RawAsync(Setting.Keys.PeriodLockedThrough);
        _cached = PeriodLock.AutoTarget(stored, Today, await GraceDaysAsync(), await HoldUntilAsync());
        _read = true;
        return _cached;
    }

    private async Task WriteAsync(string key, string value, int? userId)
    {
        var setting = await _db.Settings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting is null)
        {
            setting = new Setting { Key = key };
            _db.Settings.Add(setting);
        }
        setting.Value = value;
        setting.UpdatedAt = DateTimeOffset.UtcNow;
        setting.UpdatedByUserId = userId;
        await _db.SaveChangesAsync();
        _read = false;
    }

    public async Task EnsureOpenAsync(DateTimeOffset when, string what)
    {
        var locked = await CurrentAsync();
        if (!PeriodLock.Blocks(when, locked)) return;
        throw new ConflictAppException(
            $"الفترة مقفلة — {what} بتاريخ {when.Date:yyyy/MM/dd} واقع بشهر مقفل (مقفل لغاية {locked}). " +
            "الكشوف اللي انطبعت عن هالشهر انحاسب عليها، فما بتنعدّل. إذا لازم تصلّح، افتح الشهر من الإعدادات، " +
            "أو اكتب التصحيح بقيد بتاريخ اليوم.");
    }

    public async Task EnsureOpenAsync(DateTimeOffset before, DateTimeOffset after, string what)
    {
        await EnsureOpenAsync(before, what);
        // Only when it actually moved months — otherwise the same date is checked twice for nothing.
        if (after.Date != before.Date) await EnsureOpenAsync(after, what);
    }

    public async Task<PeriodLockStatusDto> GetStatusAsync() => await StatusAsync();

    public async Task<PeriodLockStatusDto> CloseAsync(string month, int? userId)
    {
        var asked = PeriodLock.ParseMonth(month)
            ?? throw new ValidationAppException("الشهر لازم يكون بصيغة 2026-08.");

        // Closing a month that has not finished would lock away days nobody has worked yet.
        if (asked >= new DateOnly(Today.Year, Today.Month, 1))
            throw new ValidationAppException("ما بينقفل شهر لسا ما خلص. أقصى إشي الشهر اللي قبل هاد.");

        var current = PeriodLock.ParseMonth(await CurrentAsync());
        if (current is not null && asked <= current.Value)
            throw new ValidationAppException($"هاد الشهر مقفل أصلاً — مقفل لغاية {PeriodLock.FormatMonth(current.Value)}.");

        await WriteAsync(Setting.Keys.PeriodLockedThrough, PeriodLock.FormatMonth(asked), userId);
        // A hold left over from an earlier reopen has been overtaken by a decision to close.
        await WriteAsync(Setting.Keys.PeriodAutoLockHoldUntil, "", userId);
        return await StatusAsync();
    }

    public async Task<PeriodLockStatusDto> ReopenAsync(int? userId)
    {
        var current = await CurrentAsync();
        if (PeriodLock.ParseMonth(current) is null)
            throw new ValidationAppException("ما فيه شهر مقفل.");

        await WriteAsync(Setting.Keys.PeriodLockedThrough, PeriodLock.AfterReopen(current) ?? "", userId);
        // Without this the next write would close it again immediately, since the month is long
        // over — the reopen has to outlive the request that asked for it.
        await WriteAsync(
            Setting.Keys.PeriodAutoLockHoldUntil,
            Today.AddDays(PeriodLock.ReopenHoldDays).ToString("yyyy-MM-dd"),
            userId);
        return await StatusAsync();
    }

    private async Task<PeriodLockStatusDto> StatusAsync()
    {
        var locked = await CurrentAsync();
        var grace = await GraceDaysAsync();
        var hold = await HoldUntilAsync();
        var closedThrough = PeriodLock.ClosedThrough(locked);

        // The one safe place to persist what the automatic close worked out: nothing else is being
        // saved here, and it keeps the stored setting readable to anyone looking at the table.
        if (locked != await RawAsync(Setting.Keys.PeriodLockedThrough))
            await WriteAsync(Setting.Keys.PeriodLockedThrough, locked ?? "", null);

        // What closes next, and on what day — so the screen can say it before it happens rather
        // than leaving somebody to discover the lock by being refused.
        string? nextMonth = null;
        DateOnly? nextAt = null;
        // Nothing closes by itself until a first month has been closed by hand (see
        // PeriodLock.AutoTarget), so until then there is no next one to announce either.
        if (grace > 0 && PeriodLock.ParseMonth(locked) is { } lockedMonth)
        {
            var candidate = lockedMonth.AddMonths(1);
            if (candidate < new DateOnly(Today.Year, Today.Month, 1))
            {
                nextMonth = PeriodLock.FormatMonth(candidate);
                var due = PeriodLock.EndOfMonth(candidate).AddDays(grace);
                nextAt = hold is not null && hold.Value >= due ? hold.Value.AddDays(1) : due;
            }
        }

        return new PeriodLockStatusDto(
            LockedThroughMonth: locked,
            ClosedThrough: closedThrough?.ToString("yyyy-MM-dd"),
            AutoLockDays: grace,
            HoldUntil: hold?.ToString("yyyy-MM-dd"),
            NextMonthToClose: nextMonth,
            NextCloseOn: nextAt?.ToString("yyyy-MM-dd"),
            ClosableNow: PeriodLock.FormatMonth(PeriodLock.PreviousMonth(Today)));
    }
}
