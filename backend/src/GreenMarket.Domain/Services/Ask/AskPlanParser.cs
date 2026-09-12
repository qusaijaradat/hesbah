using System.Text.Json;

namespace GreenMarket.Domain.Services.Ask;

/// <summary>
/// Reads the model's reply into an <see cref="AskPlan"/>.
///
/// Separate from the code that makes the API call, and here in the domain rather than beside it,
/// because this is the one input in the whole feature that nothing else validates — it comes from
/// outside, and everything downstream trusts it. Pure and reachable from the smoke tests for
/// exactly that reason.
///
/// Anything it cannot recognise becomes <see cref="AskIntent.Unknown"/>, which answers "ما بعرف".
/// Falling through to some nearby intent instead would answer a question nobody asked, with real
/// figures, and look entirely correct.
/// </summary>
public static class AskPlanParser
{
    public static AskPlan Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return new AskPlan(AskIntent.Unknown);

            var intentName = root.TryGetProperty("intent", out var i) && i.ValueKind == JsonValueKind.String
                ? i.GetString() : null;
            if (!Enum.TryParse<AskIntent>(intentName, ignoreCase: true, out var intent))
                intent = AskIntent.Unknown;

            static string? Str(JsonElement e, string name) =>
                e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

            // A date the model wrote in words ("يوم الثلاثاء") is dropped rather than guessed at:
            // an answer over the wrong dates is the one wrong answer that looks right.
            static DateTimeOffset? Date(JsonElement e, string name) =>
                DateTimeOffset.TryParse(Str(e, name), out var d) ? d : null;

            int? limit = root.TryGetProperty("limit", out var l) && l.ValueKind == JsonValueKind.Number
                ? l.GetInt32() : null;

            return new AskPlan(
                intent,
                Str(root, "partnerName"),
                Date(root, "dateFrom"),
                Date(root, "dateTo"),
                limit,
                Str(root, "understood"));
        }
        catch (JsonException)
        {
            return new AskPlan(AskIntent.Unknown);
        }
    }
}
