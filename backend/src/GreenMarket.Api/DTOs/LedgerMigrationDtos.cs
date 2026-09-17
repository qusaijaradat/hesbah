namespace GreenMarket.Api.DTOs;

/// <summary>
/// What the one-time "move the produce money onto the driver" migration would do, or has done.
///
/// Every figure here is read-only — asking for this changes nothing. It exists so the market can
/// look at the whole move before agreeing to it, per person and in shekels, rather than pressing a
/// button and then going to check the accounts one by one to find out what happened.
/// </summary>
/// <param name="CanRun">False when something in the way makes the move unsafe or meaningless —
/// see <paramref name="Blocker"/>.</param>
/// <param name="Blocker">Why it cannot run, in Arabic, for the screen. Null when it can.</param>
/// <param name="AlreadyMigrated">True when a move has been run and not undone. The screen then
/// offers the undo instead of the move.</param>
/// <param name="LastRunAt">When that run happened.</param>
/// <param name="HouseDriverName">The partner standing for the market's own vehicle, if one is set.
/// Loads he brought are deliberately left with their sellers.</param>
/// <param name="RowsToMove">How many ledger rows would change hands.</param>
/// <param name="AmountToMove">Their total, which is what moves off the sellers and onto the drivers.</param>
/// <param name="InvoicesAffected">How many invoices those rows belong to.</param>
/// <param name="Sellers">Each seller losing money off his account, worst first.</param>
/// <param name="Drivers">Each driver gaining it.</param>
/// <param name="Notes">Things worth knowing that are NOT part of the move — see the service.</param>
public record LedgerMigrationPreviewDto(
    bool CanRun,
    string? Blocker,
    bool AlreadyMigrated,
    DateTimeOffset? LastRunAt,
    string? HouseDriverName,
    int RowsToMove,
    decimal AmountToMove,
    int InvoicesAffected,
    IReadOnlyList<LedgerMigrationPartnerRow> Sellers,
    IReadOnlyList<LedgerMigrationPartnerRow> Drivers,
    IReadOnlyList<string> Notes);

/// <param name="Rows">How many ledger rows of this person's move.</param>
/// <param name="Amount">Their total. Positive on both sides — the direction is which list it is in.</param>
/// <param name="BalanceBefore">The account as it stands now, opening balance included.</param>
/// <param name="BalanceAfter">Where it lands if the move runs.</param>
public record LedgerMigrationPartnerRow(
    int PartnerId,
    string Name,
    int Rows,
    decimal Amount,
    decimal BalanceBefore,
    decimal BalanceAfter);

/// <summary>What actually happened, returned after a run so the screen can state it plainly.</summary>
public record LedgerMigrationResultDto(
    Guid RunId,
    string Direction,
    int RowsMoved,
    decimal AmountMoved);
