namespace GreenMarket.Api.DTOs;

/// <summary>What kind of record a search row points at — the frontend picks an icon from it.</summary>
public enum SearchHitKind
{
    Partner = 1,
    Invoice = 2,
    Item = 3
}

/// <summary>
/// One row in the search dropdown: what it is, what it is called, one line of context, and where
/// tapping it goes.
///
/// <paramref name="Url"/> is a route in this app, decided server-side because the destination
/// depends on facts the search already has in hand — a partner who is both a buyer and a seller
/// has two accounts and therefore two rows, each pointing at its own one.
///
/// No amounts anywhere. A dropdown under a search box is read over somebody's shoulder far more
/// often than an account page is, and the name and the date identify a record perfectly well
/// without saying what it is worth.
/// </summary>
public record SearchHitDto(SearchHitKind Kind, int Id, string Title, string Subtitle, string Url);
