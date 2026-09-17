namespace GreenMarket.Domain.Entities;

/// <summary>
/// One ledger row that a balance migration moved from one person's account to another's, and where
/// it came from.
///
/// The market changed who it owes for a load: the produce money follows the driver who brought it,
/// not the seller (see Domain.Services.InvoiceLedgerTarget). New invoices post correctly from the
/// day that shipped, but every invoice already on the books still had its money sitting on the
/// seller. Moving those is a one-time job, and this table is its record.
///
/// It exists for one reason: so that undoing the move is EXACT. Everything else that could serve as
/// a record is a guess after the fact — matching amounts, matching notes, working backwards from
/// what the rule says the answer should be. A migration that moves real money between real people's
/// accounts is the last place to reverse by inference, and the first place somebody will want to
/// reverse at all, having watched a balance change and wanted a minute to think about it.
///
/// Deliberately NOT an AuditableEntity: nothing edits these rows, they are the audit. The interceptor
/// records the underlying FarmerTransaction changes on its own, and this sits alongside that as the
/// list of exactly which rows one run touched.
/// </summary>
public class LedgerMigrationEntry
{
    public long Id { get; set; }

    /// <summary>Every row one run moved shares a RunId, so a run is undone as one thing.</summary>
    public Guid RunId { get; set; }

    public DateTimeOffset At { get; set; }

    /// <summary>Who pressed the button. Null only for a run started outside a request.</summary>
    public int? RunByUserId { get; set; }

    /// <summary>
    /// <see cref="LedgerMigrationDirection.ToDriver"/> or <see cref="LedgerMigrationDirection.ToSeller"/>.
    /// Stored as text rather than an enum's number so a person reading the table with a SQL client
    /// can see which way the money went without a lookup.
    /// </summary>
    public string Direction { get; set; } = string.Empty;

    public int FarmerTransactionId { get; set; }
    public int InvoiceId { get; set; }

    /// <summary>Whose account the row was on before this run — where an undo puts it back.</summary>
    public int FromPartnerId { get; set; }
    public int ToPartnerId { get; set; }

    /// <summary>The row's Amount as it stood when it moved, so the record says how much moved
    /// without having to go and read the transaction as it is now.</summary>
    public decimal Amount { get; set; }
}

/// <summary>Which way a <see cref="LedgerMigrationEntry"/> run moved the money.</summary>
public static class LedgerMigrationDirection
{
    /// <summary>Onto the driver who brought the load — the change itself.</summary>
    public const string ToDriver = "ToDriver";

    /// <summary>Back onto the seller — an undo of a ToDriver run.</summary>
    public const string ToSeller = "ToSeller";
}
