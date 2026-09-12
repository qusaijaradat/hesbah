namespace GreenMarket.Domain.Services;

/// <summary>
/// Requirement doc §4 — per-line and invoice-level totals. Pulled out of the entity/EF
/// layer so the exact same math runs in the API, in a print preview, and in this
/// project's offline smoke tests.
/// </summary>
public static class InvoiceCalculator
{
    /// <summary>
    /// One line as typed. <paramref name="Quantity"/> is العدد and is always given;
    /// <paramref name="WeightKg"/> is الوزن and is optional — see <see cref="LineTotalFor"/> for
    /// what that difference does. BoxQuantity/CartonQuantity are the containers that went out with
    /// the line, counted separately from both.
    /// </summary>
    public readonly record struct LineInput(
        string ItemName, decimal Quantity, decimal? WeightKg, decimal PricePerUnit,
        decimal BoxQuantity = 0, decimal CartonQuantity = 0, decimal WoodPrice = 0);

    public readonly record struct LineResult(
        string ItemName, decimal Quantity, decimal? WeightKg, decimal PricePerUnit,
        decimal BoxQuantity, decimal CartonQuantity, decimal WoodPrice, decimal LineTotal);

    /// <summary>
    /// TotalWeightKg is every line's الوزن, and TotalBoxes/TotalCartons every line's own container
    /// counts — all three are now plain sums, where each used to depend on the line's unit and so
    /// silently skipped the lines of the other kind. TotalBoxes is what رسوم الصناديق and the
    /// driver's أجرة الصناديق are charged on (see Invoice.BoxPriceApplied); cartons are counted for
    /// the containers ledger and never charged. WoodTotal is the sum of every line's WoodPrice (a
    /// flat per-line add-on, not multiplied by anything) — deliberately kept OUT of TotalValue so it
    /// never inflates the commission base; see Invoice.TransportFee for the same reasoning applied
    /// at the invoice level.
    /// </summary>
    public readonly record struct InvoiceTotals(
        decimal TotalWeightKg, decimal TotalBoxes, decimal TotalCartons,
        decimal TotalValue, decimal WoodTotal, IReadOnlyList<LineResult> Lines);

    /// <summary>
    /// The one place that decides what a line is worth: الوزن × السعر when the line was weighed,
    /// otherwise العدد × السعر.
    ///
    /// Which of the two applies used to be carried by a Kg/Box unit on the line, so a line could be
    /// one or the other but never both — and a crate count on a weighed line had nowhere to live.
    /// Now the weight's own presence says it, and the counts are free to be counts. A weight of 0
    /// reads the same as no weight at all: nothing was weighed, so it is priced by العدد.
    /// </summary>
    public static decimal LineTotalFor(decimal quantity, decimal? weightKg, decimal pricePerUnit) =>
        Math.Round((weightKg is > 0 ? weightKg.Value : quantity) * pricePerUnit, 2, MidpointRounding.AwayFromZero);

    public static InvoiceTotals Calculate(IEnumerable<LineInput> lines)
    {
        var results = new List<LineResult>();
        decimal totalWeightKg = 0m;
        decimal totalBoxes = 0m;
        decimal totalCartons = 0m;
        decimal totalValue = 0m;
        decimal woodTotal = 0m;

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line.ItemName))
                throw new ArgumentException("Item name is required.", nameof(lines));
            // العدد is required on every line — it is what the line is priced by whenever it was not
            // weighed, and what the containers it went out in are read against.
            if (line.Quantity <= 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Count for '{line.ItemName}' must be greater than zero.");
            if (line.WeightKg is < 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Weight for '{line.ItemName}' cannot be negative.");
            if (line.PricePerUnit < 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Price for '{line.ItemName}' cannot be negative.");
            if (line.BoxQuantity < 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Box count for '{line.ItemName}' cannot be negative.");
            if (line.CartonQuantity < 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Carton count for '{line.ItemName}' cannot be negative.");
            if (line.WoodPrice < 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Wood price for '{line.ItemName}' cannot be negative.");

            var lineTotal = LineTotalFor(line.Quantity, line.WeightKg, line.PricePerUnit);
            results.Add(new LineResult(
                line.ItemName, line.Quantity, line.WeightKg, line.PricePerUnit,
                line.BoxQuantity, line.CartonQuantity, line.WoodPrice, lineTotal));

            totalWeightKg += line.WeightKg ?? 0m;
            totalBoxes += line.BoxQuantity;
            totalCartons += line.CartonQuantity;
            totalValue += lineTotal;
            woodTotal += line.WoodPrice;
        }

        if (results.Count == 0)
            throw new ArgumentException("An invoice must have at least one item.", nameof(lines));

        return new InvoiceTotals(totalWeightKg, totalBoxes, totalCartons, totalValue, woodTotal, results);
    }
}
