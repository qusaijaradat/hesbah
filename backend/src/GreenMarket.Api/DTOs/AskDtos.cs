
/// <summary>
/// What a photographed ledger page came back as — see Services.Ask.PageReader.
///
/// Rows land in a form the market reads and corrects before anything is saved; nothing here
/// reaches the database on its own.
/// </summary>
/// <param name="Note">What the reader could not manage, in Arabic, shown to whoever photographed
/// the page. Empty when the page was clear. A reader that quietly drops the rows it found hard is
/// worse than one that says so.</param>
public record PageReadResult(IReadOnlyList<PageReadRow> Rows, string Note);

/// <summary>
/// One row off the page. Every field is nullable because a cell that could not be read comes back
/// empty, never as a plausible number — a blank box is a question somebody answers, and an
/// invented price is a wrong invoice nobody catches.
/// </summary>
public record PageReadRow(
    string? Merchant, string? Farmer, string? Driver,
    string? ItemName,
    decimal? Quantity, decimal? WeightKg, decimal? PricePerUnit,
    decimal? WoodPrice, decimal? TransportFee);
