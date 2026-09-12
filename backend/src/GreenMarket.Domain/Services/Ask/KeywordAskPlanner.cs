using System.Text;

namespace GreenMarket.Domain.Services.Ask;

/// <summary>
/// Reads an Arabic question into an <see cref="AskPlan"/> with no model and no API call — free,
/// offline, instant, and the same answer every time for the same question.
///
/// It works here because the problem is small in a way general language understanding is not: there
/// are twelve questions, they are asked in a handful of phrasings, and — the part that matters —
/// the NAMES are not guessed at all. They are matched against the partners actually on file, which
/// is strictly more reliable than a model reading a name out of free text, since a name that is not
/// in the database is not a name this system can answer about anyway.
///
/// What it cannot do is understand a sentence it has no words for. That is the honest trade: a
/// question phrased unusually lands on <see cref="AskIntent.Unknown"/> and says so, where a model
/// would have got it. The answer to that is to add the phrasing here — where it then works forever,
/// for free, and identically for everyone.
/// </summary>
public static class KeywordAskPlanner
{
    /// <summary>
    /// Arabic spelling varies in ways that carry no meaning here — أ/إ/آ for ا, ة for ه, ى for ي,
    /// plus diacritics and tatweel — and a question typed one way must match a name stored the
    /// other. Everything below compares normalized text.
    /// </summary>
    public static string Normalize(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var sb = new StringBuilder(text.Length);
        foreach (var raw in text)
        {
            var c = raw switch
            {
                'أ' or 'إ' or 'آ' or 'ٱ' => 'ا',
                'ة' => 'ه',
                'ى' => 'ي',
                'ؤ' => 'و',
                'ئ' => 'ي',
                _ => raw,
            };
            // Harakat (064B-0652), tatweel (0640) and the Arabic-Indic digits' own marks carry no
            // meaning for matching; drop them rather than letting them split a word in two.
            if (c == 'ـ' || (c >= 'ً' && c <= 'ْ')) continue;
            // Arabic-Indic digits are the same numbers — the notebook is written in them.
            if (c >= '٠' && c <= '٩') c = (char)('0' + (c - '٠'));
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    private static bool Has(string haystack, params string[] needles) =>
        needles.Any(n => haystack.Contains(Normalize(n), StringComparison.Ordinal));

    /// <summary>
    /// <paramref name="knownPartnerNames"/> is every partner on file. A name is only "found" if it
    /// is one of these, which is what makes the name half of this exact rather than approximate.
    /// </summary>
    public static AskPlan Plan(string question, IReadOnlyCollection<string> knownPartnerNames, DateTimeOffset today)
    {
        var q = Normalize(question ?? "");
        if (q.Trim().Length == 0) return new AskPlan(AskIntent.Unknown);

        var (from, to, periodLabel) = ReadPeriod(q, today);
        var name = FindName(q, knownPartnerNames);

        // With a person named, the question is about THAT person — which of the three depends only
        // on whether it says sold, bought, or neither.
        if (name is not null)
        {
            if (Has(q, "باع", "مبيعات", "بيعات"))
                return new AskPlan(AskIntent.PartnerSales, name, from, to, null, $"مبيعات {name}{periodLabel}");
            if (Has(q, "اشترى", "شرى", "مشتريات", "اشتريات"))
                return new AskPlan(AskIntent.PartnerPurchases, name, from, to, null, $"مشتريات {name}{periodLabel}");
            return new AskPlan(AskIntent.PartnerBalance, name, null, null, null, $"رصيد {name}");
        }

        // No name: the specific lists first, so a word they share with a broader phrase does not
        // pull the question to the wrong one.
        if (Has(q, "صناديق", "صندوق", "كرتون", "مخالات", "مخلاه", "ماسك"))
            return new AskPlan(AskIntent.ContainersHeld, null, null, null, null, "مين ماسك أوعية المصلحة");

        if (Has(q, "شيك", "شيكات"))
            return new AskPlan(AskIntent.ChecksDue, null, null, null, null, "الشيكات المستحقة والمتأخرة");

        if (Has(q, "بدون سعر", "مش مسعر", "غير مسعر", "بلا سعر", "ما تسعر"))
            return new AskPlan(AskIntent.UnpricedInvoices, null, null, null, null, "الفواتير اللي فيها أصناف بدون سعر");

        if (Has(q, "ما دفع", "مش مدفوع", "غير مدفوع", "ما دفعوا", "مش مدفوعه", "غير مدفوعه"))
            return new AskPlan(AskIntent.UnpaidInvoices, null, null, null, null, "الفواتير غير المدفوعة");

        // "شو صار" on its own, with the day coming from the period words — matching the whole
        // phrase "شو صار اليوم" meant "شو صار امبارح" fell through to Unknown, which is the same
        // question about a different day. A closing is ONE day, so a question naming a week or a
        // month is left to fall through to the period answers below rather than silently reporting
        // the first day of it: To is set only for the single-day periods.
        if (Has(q, "اغلاق", "شو صار", "ملخص اليوم", "اليوميه") && (to is not null || from is null))
            return new AskPlan(AskIntent.DailyClosing, null, from ?? today, null, null, $"إغلاق يوم {(from ?? today):yyyy-MM-dd}");

        if (Has(q, "ربح", "ربحت", "ارباح", "كسب", "كسبنا"))
            return new AskPlan(AskIntent.MarketProfit, null, from, to, null, $"ربح المصلحة{periodLabel}");

        if (Has(q, "اكتر صنف", "اكثر صنف", "افضل صنف", "اكتر الاصناف", "اصناف مبيعا", "اكتر بضاعه"))
            return new AskPlan(AskIntent.TopItems, null, from, to, null, $"أكتر الأصناف مبيعًا{periodLabel}");

        // "من علينا" vs "مين عليه" — these two are opposite directions and one letter apart, so they
        // are matched on whole phrases rather than on a shared word.
        if (Has(q, "الو عنا", "له عنا", "مستحقات", "احنا عليه", "علينا لمين", "لمين علينا", "بدنا ندفع"))
            return new AskPlan(AskIntent.TopCreditors, null, null, null, null, "مين إلو مستحقات عنا");

        if (Has(q, "عليه دين", "عليهم دين", "الديون", "مدين", "مين عليه", "اكتر واحد عليه"))
            return new AskPlan(AskIntent.TopDebtors, null, null, null, null, "مين عليه دين");

        // "كم باع" / "كم اشترى" with nobody named: the question is real but the person is missing,
        // and saying which is missing beats a blank "ما بعرف".
        if (Has(q, "باع", "اشترى", "رصيد", "حساب"))
            return new AskPlan(AskIntent.Unknown, null, null, null, null, "السؤال عن شخص بس ما عرفت مين");

        return new AskPlan(AskIntent.Unknown);
    }

    /// <summary>
    /// The relative periods people actually say. Anything not listed leaves the dates unset, which
    /// every intent reads as "all time" — a wider answer, never a wrong one.
    /// </summary>
    private static (DateTimeOffset? From, DateTimeOffset? To, string Label) ReadPeriod(string q, DateTimeOffset today)
    {
        var startOfDay = new DateTimeOffset(today.Year, today.Month, today.Day, 0, 0, 0, today.Offset);

        if (Has(q, "امبارح", "البارحه", "مبارح"))
        {
            var y = startOfDay.AddDays(-1);
            return (y, y.AddDays(1).AddTicks(-1), " امبارح");
        }
        if (Has(q, "اليوم", "هاليوم"))
            return (startOfDay, startOfDay.AddDays(1).AddTicks(-1), " اليوم");
        if (Has(q, "هالاسبوع", "هذا الاسبوع", "الاسبوع", "اخر اسبوع", "7 ايام"))
            return (startOfDay.AddDays(-7), null, " آخر أسبوع");
        if (Has(q, "هالشهر", "هذا الشهر", "الشهر"))
            return (new DateTimeOffset(today.Year, today.Month, 1, 0, 0, 0, today.Offset), null, " هالشهر");
        if (Has(q, "هالسنه", "هذه السنه", "السنه"))
            return (new DateTimeOffset(today.Year, 1, 1, 0, 0, 0, today.Offset), null, " هالسنة");

        return (null, null, "");
    }

    /// <summary>
    /// The longest partner name that appears in the question wins — "أبو علي النجار" must not lose
    /// to "أبو علي" when both are on file and the question names the longer one.
    /// </summary>
    private static string? FindName(string normalizedQuestion, IReadOnlyCollection<string> knownPartnerNames)
    {
        string? best = null;
        var bestLength = 0;
        foreach (var candidate in knownPartnerNames)
        {
            var normalized = Normalize(candidate).Trim();
            // Two characters matches half the language; a real name is longer than that.
            if (normalized.Length < 3) continue;
            if (!normalizedQuestion.Contains(normalized, StringComparison.Ordinal)) continue;
            if (normalized.Length <= bestLength) continue;
            best = candidate;
            bestLength = normalized.Length;
        }
        return best;
    }
}
