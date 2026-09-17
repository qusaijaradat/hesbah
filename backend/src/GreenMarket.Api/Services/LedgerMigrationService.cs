using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface ILedgerMigrationService
{
    Task<LedgerMigrationPreviewDto> PreviewAsync();
    Task<LedgerMigrationResultDto> RunAsync(int? userId);
    Task<LedgerMigrationResultDto> UndoAsync(int? userId);
}

/// <summary>
/// The one-time move of historical balances from sellers onto the drivers who brought their loads.
///
/// From the day InvoiceLedgerTarget shipped, a new invoice posts its produce money to the driver.
/// Every invoice already on the books kept its money on the seller, so the two halves of the same
/// ledger described two different arrangements. This closes that, once.
///
/// Three rules it holds itself to, because it moves real money between real people's accounts:
///
///  1. Nothing happens without being shown first. PreviewAsync reads and computes and writes
///     nothing, and it names every person on both sides with the balance they have now and the one
///     they would have after.
///  2. Every move is recorded exactly (LedgerMigrationEntry), so the undo puts each row back where
///     it actually came from rather than where a rule says it probably was.
///  3. Only ACTIVE invoices, and only the rows that sit on that invoice's own seller. A cancelled
///     invoice is left alone: its sale and the reversal posted against it already net to zero, so
///     moving the pair achieves nothing and touches rows for no reason.
/// </summary>
public class LedgerMigrationService : ILedgerMigrationService
{
    private readonly AppDbContext _db;
    private readonly ISettingsService _settings;

    public LedgerMigrationService(AppDbContext db, ISettingsService settings)
    {
        _db = db;
        _settings = settings;
    }

    /// <summary>One ledger row and where it is going. The unit both the preview and the run work in,
    /// so what was shown and what happens cannot be assembled two different ways.</summary>
    private readonly record struct Move(FarmerTransaction Row, int From, int To, int InvoiceId);

    public async Task<LedgerMigrationPreviewDto> PreviewAsync()
    {
        var lastRun = await LastRunAsync();
        var alreadyMigrated = lastRun?.Direction == LedgerMigrationDirection.ToDriver;

        var houseDriverId = await _settings.GetIntOrNullAsync(Setting.Keys.HouseDriverPartnerId);
        var houseDriverName = houseDriverId is null
            ? null
            : (await _db.Partners.FindAsync(houseDriverId.Value))?.Name;

        var notes = new List<string>();
        if (houseDriverId is null)
            notes.Add("ما فيه «سائق المصلحة» محدّد بالإعدادات — يعني كل سائق مكتوب على الفواتير بينحسب سائق برّاني وبينتقل له الرصيد. إذا في عندك شخص اسمه «المصلحة» بخانة السائق، حدّده بالإعدادات قبل ما تنفّذ.");
        else if (houseDriverName is null)
            notes.Add("«سائق المصلحة» المحدّد بالإعدادات ما عاد موجود كشخص — راجع الإعدادات قبل ما تنفّذ.");
        else
            notes.Add($"فواتير سائقها «{houseDriverName}» رح تضل مرصودة عند الباعة زي ما هي.");

        // Already moved? Then the preview describes the UNDO instead, off the recorded run rather
        // than off the rule — which is the whole point of having recorded it.
        if (alreadyMigrated)
        {
            var entries = await _db.LedgerMigrationEntries.Where(e => e.RunId == lastRun!.RunId).ToListAsync();
            var undoRows = await BuildUndoAsync(entries);
            // Undoing runs the other way, so the drivers are the side losing it and the sellers
            // the side getting it back. The screen's two lists stay "باعة" and "سواق" either way.
            var (fromDrivers, toSellers) = await SummariseAsync(undoRows);
            notes.Add("النقل انعمل قبل. الزر تحت بيرجّع كل سطر لمكانه الأصلي بالضبط، مش بالتخمين.");
            if (undoRows.Count != entries.Count)
                notes.Add($"{entries.Count - undoRows.Count} سطر من النقل الأصلي ما عاد على حساب السائق (انحذف أو اتعدّل بعدها) — هدول رح ينترَكوا زي ما هم.");

            return new LedgerMigrationPreviewDto(
                CanRun: undoRows.Count > 0,
                Blocker: undoRows.Count > 0 ? null : "ما ضل إشي للتراجع عنه.",
                AlreadyMigrated: true,
                LastRunAt: lastRun!.At,
                HouseDriverName: houseDriverName,
                RowsToMove: undoRows.Count,
                AmountToMove: undoRows.Sum(m => m.Row.Amount),
                InvoicesAffected: undoRows.Select(m => m.InvoiceId).Distinct().Count(),
                Sellers: toSellers,
                Drivers: fromDrivers,
                Notes: notes);
        }

        var moves = await BuildForwardAsync(houseDriverId);
        var (losing, gaining) = await SummariseAsync(moves);

        var noDriverCount = await _db.Invoices
            .CountAsync(i => i.Status == InvoiceStatus.Active && i.FarmerId != null && i.DriverId == null);
        if (noDriverCount > 0)
            notes.Add($"{noDriverCount} فاتورة بدون سائق — رصيدها بيضل عند البائع، ما بتنلمس.");

        return new LedgerMigrationPreviewDto(
            CanRun: moves.Count > 0,
            Blocker: moves.Count > 0 ? null : "ما فيه أي رصيد بحاجة لنقل — كل الفواتير مرصودة صح أصلاً.",
            AlreadyMigrated: false,
            LastRunAt: lastRun?.At,
            HouseDriverName: houseDriverName,
            RowsToMove: moves.Count,
            AmountToMove: moves.Sum(m => m.Row.Amount),
            InvoicesAffected: moves.Select(m => m.InvoiceId).Distinct().Count(),
            Sellers: losing,
            Drivers: gaining,
            Notes: notes);
    }

    public async Task<LedgerMigrationResultDto> RunAsync(int? userId)
    {
        var lastRun = await LastRunAsync();
        if (lastRun?.Direction == LedgerMigrationDirection.ToDriver)
            throw new ConflictAppException("النقل انعمل قبل. إذا بدك تعيده، تراجع عنه أولاً.");

        var houseDriverId = await _settings.GetIntOrNullAsync(Setting.Keys.HouseDriverPartnerId);
        var moves = await BuildForwardAsync(houseDriverId);
        if (moves.Count == 0)
            throw new ValidationAppException("ما فيه أي رصيد بحاجة لنقل.");

        return await ApplyAsync(moves, LedgerMigrationDirection.ToDriver, userId);
    }

    public async Task<LedgerMigrationResultDto> UndoAsync(int? userId)
    {
        var lastRun = await LastRunAsync();
        if (lastRun?.Direction != LedgerMigrationDirection.ToDriver)
            throw new ConflictAppException("ما فيه نقل للتراجع عنه.");

        var entries = await _db.LedgerMigrationEntries.Where(e => e.RunId == lastRun.RunId).ToListAsync();
        var moves = await BuildUndoAsync(entries);
        if (moves.Count == 0)
            throw new ValidationAppException("ما ضل أي سطر من النقل الأصلي على حساب السائق.");

        return await ApplyAsync(moves, LedgerMigrationDirection.ToSeller, userId);
    }

    // ---------------------------------------------------------------- planning

    /// <summary>
    /// Every ledger row sitting on a seller that, under the current rule, belongs to the driver who
    /// brought the load.
    ///
    /// Scoped to rows whose FarmerId is the invoice's OWN seller, which is what picks up the sale
    /// together with any مرتجع credited against it and leaves the driver's haulage row where it
    /// already is. Payments never match: a Payment row carries no InvoiceId at all.
    /// </summary>
    private async Task<List<Move>> BuildForwardAsync(int? houseDriverId)
    {
        var invoices = await _db.Invoices
            .Where(i => i.Status == InvoiceStatus.Active && i.FarmerId != null && i.DriverId != null)
            .Select(i => new { i.Id, FarmerId = i.FarmerId!.Value, DriverId = i.DriverId!.Value })
            .ToListAsync();

        var targets = invoices
            .Where(i => InvoiceLedgerTarget.SaleGoesTo(i.FarmerId, i.DriverId, houseDriverId) != i.FarmerId)
            .ToDictionary(i => i.Id, i => i);
        if (targets.Count == 0) return new List<Move>();

        var invoiceIds = targets.Keys.ToList();
        var rows = await _db.FarmerTransactions
            .Where(t => t.InvoiceId != null && invoiceIds.Contains(t.InvoiceId.Value))
            .ToListAsync();

        return rows
            .Where(t => targets[t.InvoiceId!.Value].FarmerId == t.FarmerId)
            .Select(t =>
            {
                var invoice = targets[t.InvoiceId!.Value];
                return new Move(t, invoice.FarmerId, invoice.DriverId, invoice.Id);
            })
            .ToList();
    }

    /// <summary>
    /// The recorded run, read back as moves in the opposite direction.
    ///
    /// A row is only put back if it is still where the run left it. One that has since been deleted,
    /// or moved again by an ordinary edit, is skipped rather than dragged backwards — the later
    /// change is somebody's deliberate act and the undo has no business overruling it.
    /// </summary>
    private async Task<List<Move>> BuildUndoAsync(IReadOnlyList<LedgerMigrationEntry> entries)
    {
        if (entries.Count == 0) return new List<Move>();

        var ids = entries.Select(e => e.FarmerTransactionId).ToList();
        var rows = await _db.FarmerTransactions.Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id);

        return entries
            .Where(e => rows.ContainsKey(e.FarmerTransactionId) && rows[e.FarmerTransactionId].FarmerId == e.ToPartnerId)
            .Select(e => new Move(rows[e.FarmerTransactionId], e.ToPartnerId, e.FromPartnerId, e.InvoiceId))
            .ToList();
    }

    // ---------------------------------------------------------------- doing it

    private async Task<LedgerMigrationResultDto> ApplyAsync(IReadOnlyList<Move> moves, string direction, int? userId)
    {
        var runId = Guid.NewGuid();
        var at = DateTimeOffset.UtcNow;

        // One transaction for the whole move. Half a migration is worse than none: the sellers'
        // side would be emptied with the drivers' side never filled, and no single account would
        // look wrong enough for anyone to notice which half had happened.
        await using var transaction = await _db.Database.BeginTransactionAsync();

        foreach (var move in moves)
        {
            move.Row.FarmerId = move.To;
            _db.LedgerMigrationEntries.Add(new LedgerMigrationEntry
            {
                RunId = runId,
                At = at,
                RunByUserId = userId,
                Direction = direction,
                FarmerTransactionId = move.Row.Id,
                InvoiceId = move.InvoiceId,
                FromPartnerId = move.From,
                ToPartnerId = move.To,
                Amount = move.Row.Amount
            });
        }

        // The AuditSaveChangesInterceptor writes its own before/after row per moved transaction on
        // this same save, so the edit history shows the move the way it shows every other edit.
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return new LedgerMigrationResultDto(runId, direction, moves.Count, moves.Sum(m => m.Row.Amount));
    }

    // ---------------------------------------------------------------- showing it

    private async Task<LedgerMigrationEntry?> LastRunAsync() =>
        await _db.LedgerMigrationEntries.OrderByDescending(e => e.Id).FirstOrDefaultAsync();

    /// <summary>
    /// The move as two lists of people: who it comes off, and who it goes onto — each with the
    /// balance they have now and the one they would have after.
    ///
    /// Balances through PartnerBalance.ForSeller, the same function every account screen uses, so
    /// "BalanceBefore" here is the figure the person's own page is showing at this moment and can
    /// be checked against it.
    /// </summary>
    private async Task<(List<LedgerMigrationPartnerRow> From, List<LedgerMigrationPartnerRow> To)> SummariseAsync(
        IReadOnlyList<Move> moves)
    {
        if (moves.Count == 0)
            return (new List<LedgerMigrationPartnerRow>(), new List<LedgerMigrationPartnerRow>());

        var partnerIds = moves.Select(m => m.From).Concat(moves.Select(m => m.To)).Distinct().ToList();
        var partners = await _db.Partners
            .Where(p => partnerIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Name, p.OpeningBalance })
            .ToDictionaryAsync(p => p.Id);
        var ledgerNet = await _db.FarmerTransactions
            .Where(t => partnerIds.Contains(t.FarmerId))
            .GroupBy(t => t.FarmerId)
            .Select(g => new { FarmerId = g.Key, Total = g.Sum(t => t.Amount) })
            .ToDictionaryAsync(x => x.FarmerId, x => x.Total);

        decimal Balance(int id) =>
            PartnerBalance.ForSeller(
                partners.TryGetValue(id, out var p) ? p.OpeningBalance ?? 0 : 0,
                ledgerNet.GetValueOrDefault(id));

        List<LedgerMigrationPartnerRow> Side(Func<Move, int> pick, int sign) =>
            moves.GroupBy(pick)
                .Select(g =>
                {
                    var amount = g.Sum(m => m.Row.Amount);
                    var before = Balance(g.Key);
                    return new LedgerMigrationPartnerRow(
                        g.Key,
                        partners.TryGetValue(g.Key, out var p) ? p.Name : $"#{g.Key}",
                        g.Count(),
                        amount,
                        before,
                        before + (sign * amount));
                })
                .OrderByDescending(r => Math.Abs(r.Amount))
                .ToList();

        // The amount leaves the From side and lands on the To side — the same figure, twice, with
        // one sign each way. Written as one expression with a sign rather than two subtractions,
        // because two of them is how the halves stop matching.
        return (Side(m => m.From, -1), Side(m => m.To, +1));
    }
}
