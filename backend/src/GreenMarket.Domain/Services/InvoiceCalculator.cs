using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Services;

/// <summary>
/// Requirement doc §4 — per-line and invoice-level totals. Pulled out of the entity/EF
/// layer so the exact same math runs in the API, in a print preview, and in this
/// project's offline smoke tests.
/// </summary>
public static class InvoiceCalculator
{
    public readonly record struct LineInput(string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit);
    public readonly record struct LineResult(string ItemName, decimal Quantity, UnitOfMeasure Unit, decimal PricePerUnit, decimal LineTotal);

    /// <summary>TotalWeightKg only sums Kg-unit lines (see the note on Invoice.TotalWeightKg) — a
    /// box-based line simply doesn't contribute a weight.</summary>
    public readonly record struct InvoiceTotals(decimal TotalWeightKg, decimal TotalValue, IReadOnlyList<LineResult> Lines);

    public static InvoiceTotals Calculate(IEnumerable<LineInput> lines)
    {
        var results = new List<LineResult>();
        decimal totalWeightKg = 0m;
        decimal totalValue = 0m;

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line.ItemName))
                throw new ArgumentException("Item name is required.", nameof(lines));
            if (line.Quantity <= 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Quantity for '{line.ItemName}' must be greater than zero.");
            if (line.PricePerUnit < 0)
                throw new ArgumentOutOfRangeException(nameof(lines), $"Price for '{line.ItemName}' cannot be negative.");

            var lineTotal = Math.Round(line.Quantity * line.PricePerUnit, 2, MidpointRounding.AwayFromZero);
            results.Add(new LineResult(line.ItemName, line.Quantity, line.Unit, line.PricePerUnit, lineTotal));

            if (line.Unit == UnitOfMeasure.Kg)
                totalWeightKg += line.Quantity;
            totalValue += lineTotal;
        }

        if (results.Count == 0)
            throw new ArgumentException("An invoice must have at least one item.", nameof(lines));

        return new InvoiceTotals(totalWeightKg, totalValue, results);
    }
}
