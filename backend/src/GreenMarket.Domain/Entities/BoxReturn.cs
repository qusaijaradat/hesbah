using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One "empty crate return" record (explicit request, separate from the money ledger entirely):
/// the market lends out wooden crates ("صناديق") with every box-unit item on an invoice — the
/// merchant is expected to bring the same number of EMPTY crates back eventually. A merchant's
/// running "boxes owed" balance = (sum of box-unit quantities across all their own Active
/// invoices — see Invoice/InvoiceItem, PartnerService.GetMerchantAccountAsync) minus (sum of
/// Quantity across every one of THEIR BoxReturn rows here). This table only ever records the
/// RETURN side — the "given" side is derived live from invoices, same "derive it live from the
/// source of truth" approach FarmerGoodsEntry/GoodsService already use for stock, rather than a
/// separate mutable running-balance column that could drift.
///
/// Deliberately its OWN table, not reusing Payment — a crate count is not money, and mixing the
/// two would make Payment's Amount/CheckDueDate/etc. fields meaningless half the time.
/// </summary>
public class BoxReturn : AuditableEntity
{
    public int PartnerId { get; set; }
    public Partner Partner { get; set; } = null!;

    public DateTimeOffset Date { get; set; }

    /// <summary>Number of empty crates returned on this occasion. Always &gt; 0 — a correction to
    /// an over-recorded return is made by deleting the wrong row, not by recording a negative one.</summary>
    public decimal Quantity { get; set; }

    public string? Notes { get; set; }

    public int RecordedByUserId { get; set; }
}
