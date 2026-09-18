namespace GreenMarket.Domain.Services;

/// <summary>
/// Which paper ledger an invoice was copied in from.
///
/// The market runs four books, one per person writing in them, and is moving off them onto this
/// system. Goods often go out before they are priced, so an invoice is entered and finished later —
/// and when the figures do not look right, the question is always "which book do I go and check".
/// Without this on the row, the answer is to open all four.
///
/// **Temporary, and meant to be.** It is a note about where a row came from during the changeover,
/// not a fact about the business: it touches no money, no balance and no printed document, and it
/// should be deleted once the books are gone rather than quietly becoming permanent.
///
/// Free text would have defeated the purpose — "طارق" and "طارق " are two books to a filter and one
/// to a reader — so the four names live here, and here only. Adding or renaming one is an edit to
/// this list and nothing else.
/// </summary>
public static class SourceBooks
{
    public const string Tareq = "طارق";
    public const string Naser = "ناصر";
    public const string Shaker = "شاكر";
    public const string AbuAlezz = "أبو العز";

    public static readonly string[] All = { Tareq, Naser, Shaker, AbuAlezz };

    /// <summary>
    /// True for one of the four, and for "not recorded" — the field is optional, and an invoice
    /// typed straight into the system was never in a book at all.
    ///
    /// Asked of the NORMALIZED value, so this and <see cref="Normalize"/> can never disagree: a
    /// caller that validates first and stores second would otherwise refuse a stray space that
    /// storing would have silently fixed.
    /// </summary>
    public static bool IsValid(string? book)
    {
        var normalized = Normalize(book);
        return normalized is null || All.Contains(normalized);
    }

    /// <summary>Blank and whitespace both mean "not recorded", stored the one way as null.</summary>
    public static string? Normalize(string? book) =>
        string.IsNullOrWhiteSpace(book) ? null : book.Trim();
}
