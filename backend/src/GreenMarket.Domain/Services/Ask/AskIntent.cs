namespace GreenMarket.Domain.Services.Ask;

/// <summary>
/// The complete list of questions this system will answer. Nothing outside it can be asked.
///
/// This enum IS the security boundary. The obvious way to build "ask a question in Arabic" is to
/// let the model write SQL, and that is a back door into a database holding every partner's balance
/// — one prompt injection through an item name or a partner's own notes away from reading or
/// changing anything. So the model never writes a query. It reads the question and picks ONE of
/// these names plus a few parameters; the server runs a hand-written, parameterized query for that
/// name and nothing else. A question the catalog cannot express is answered "ما بعرف أجاوب على
/// هاد" — a worse answer than a wrong one is a wrong one nobody can tell is wrong.
///
/// Every intent maps onto a figure the app already computes, so an answer here can never disagree
/// with the screen that shows the same number.
/// </summary>
public enum AskIntent
{
    /// <summary>The model could not map the question onto anything below.</summary>
    Unknown = 0,

    /// <summary>"كم على أبو علي؟" / "كم إلنا عند سامي؟" — one named person's current balance.</summary>
    PartnerBalance,

    /// <summary>"مين أكتر واحد عليه دين؟" — buyers who owe, largest first.</summary>
    TopDebtors,

    /// <summary>"مين إحنا عليه؟" — sellers and drivers the market owes, largest first.</summary>
    TopCreditors,

    /// <summary>"كم باع سامي هالشهر؟" — one named seller's sales over a period.</summary>
    PartnerSales,

    /// <summary>"كم اشترى أبو علي هالأسبوع؟" — one named buyer's purchases over a period.</summary>
    PartnerPurchases,

    /// <summary>"شو أكتر صنف بينباع؟" — items by value sold over a period.</summary>
    TopItems,

    /// <summary>"كم ربحت المصلحة هالشهر؟" — what the market kept over a period.</summary>
    MarketProfit,

    /// <summary>"شو صار اليوم؟" — one day's closing figures.</summary>
    DailyClosing,

    /// <summary>"مين ما دفع؟" — active invoices still carrying a balance.</summary>
    UnpaidInvoices,

    /// <summary>"في أصناف بدون سعر؟" — invoices with a line nobody has priced yet.</summary>
    UnpricedInvoices,

    /// <summary>"شو الشيكات المستحقة؟" — cheques due or overdue.</summary>
    ChecksDue,

    /// <summary>"مين ماسك صناديقي؟" — who is holding the market's containers.</summary>
    ContainersHeld,
}

/// <summary>
/// What the model is allowed to fill in beside the intent. Deliberately tiny: a name, a date range,
/// a row cap. Everything here is treated as data by the query that uses it — a name goes into a
/// parameterized lookup, never into a string that becomes a query.
/// </summary>
public record AskPlan(
    AskIntent Intent,
    /// <summary>The person the question is about, as the model read it out of the question. Matched
    /// against partners the same fuzzy way the pickers match; never trusted to be exact.</summary>
    string? PartnerName = null,
    DateTimeOffset? DateFrom = null,
    DateTimeOffset? DateTo = null,
    /// <summary>How many rows a "top N" question wants. Clamped server-side.</summary>
    int? Limit = null,
    /// <summary>The model's own note on what it understood, shown to the person asking so a
    /// misreading is visible rather than buried under a confident-looking number.</summary>
    string? Understood = null);
