// Zero-dependency smoke test for GreenMarket.Domain.
//
// This project intentionally avoids xUnit/NUnit (which would need a NuGet restore)
// so it can be built and *actually executed* even in network-restricted environments,
// giving a real pass/fail signal on the core business math rather than just a
// "looks right" read-through.
//
// Run with:  dotnet run --project backend/tools/SmokeTests

using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;

int passed = 0;
int failed = 0;

void Check(string name, bool condition, string? detail = null)
{
    if (condition)
    {
        passed++;
        Console.WriteLine($"  [PASS] {name}");
    }
    else
    {
        failed++;
        Console.WriteLine($"  [FAIL] {name}{(detail is null ? "" : $" — {detail}")}");
    }
}

Console.WriteLine("== CommissionCalculator ==");
{
    // Exact example from requirement doc §5:
    // "بيع بقيمة 10,000 ₪ → عمولة الحسبة 700 ₪ → مستحق المزارعين 9,300 ₪"
    var r = CommissionCalculator.Calculate(10_000m, 0.07m);
    Check("10,000 @ 7% => commission 700", r.Commission == 700m, $"got {r.Commission}");
    Check("10,000 @ 7% => net due to farmer 9,300", r.NetDueToFarmer == 9_300m, $"got {r.NetDueToFarmer}");

    var zero = CommissionCalculator.Calculate(0m, 0.07m);
    Check("zero sale => zero commission & zero due", zero.Commission == 0m && zero.NetDueToFarmer == 0m);

    var configurable = CommissionCalculator.Calculate(1_000m, 0.10m);
    Check("configurable rate (10%) is honoured", configurable.Commission == 100m && configurable.NetDueToFarmer == 900m);

    try
    {
        CommissionCalculator.Calculate(-1m, 0.07m);
        Check("negative sale value throws", false, "did not throw");
    }
    catch (ArgumentOutOfRangeException)
    {
        Check("negative sale value throws", true);
    }
}

Console.WriteLine("== InvoiceCalculator ==");
{
    var lines = new[]
    {
        new InvoiceCalculator.LineInput("Tomatoes", 120m, UnitOfMeasure.Kg, 3.5m),   // 420.00
        new InvoiceCalculator.LineInput("Cucumbers", 80m, UnitOfMeasure.Kg, 2.25m),  // 180.00
        new InvoiceCalculator.LineInput("Potatoes", 200m, UnitOfMeasure.Kg, 1.10m),  // 220.00
    };

    var totals = InvoiceCalculator.Calculate(lines);
    Check("total weight = 400kg", totals.TotalWeightKg == 400m, $"got {totals.TotalWeightKg}");
    Check("total value = 820.00", totals.TotalValue == 820.00m, $"got {totals.TotalValue}");
    Check("3 line results returned", totals.Lines.Count == 3);
    Check("first line total = 420.00", totals.Lines[0].LineTotal == 420.00m, $"got {totals.Lines[0].LineTotal}");

    // A box-priced line doesn't have a "weight" — it must not contribute to TotalWeightKg,
    // only to TotalValue (requested behaviour: not everything at the market is sold by kg).
    var mixedUnits = InvoiceCalculator.Calculate(new[]
    {
        new InvoiceCalculator.LineInput("Tomatoes", 100m, UnitOfMeasure.Kg, 3m),   // 300.00, +100kg
        new InvoiceCalculator.LineInput("Lettuce boxes", 5m, UnitOfMeasure.Box, 20m), // 100.00, +0kg
    });
    Check("box line excluded from total weight", mixedUnits.TotalWeightKg == 100m, $"got {mixedUnits.TotalWeightKg}");
    Check("box line still counted in total value", mixedUnits.TotalValue == 400.00m, $"got {mixedUnits.TotalValue}");

    try
    {
        InvoiceCalculator.Calculate(Array.Empty<InvoiceCalculator.LineInput>());
        Check("empty invoice throws", false, "did not throw");
    }
    catch (ArgumentException)
    {
        Check("empty invoice throws", true);
    }

    try
    {
        InvoiceCalculator.Calculate(new[] { new InvoiceCalculator.LineInput("Bad", 0m, UnitOfMeasure.Kg, 5m) });
        Check("zero quantity line throws", false, "did not throw");
    }
    catch (ArgumentOutOfRangeException)
    {
        Check("zero quantity line throws", true);
    }
}

Console.WriteLine("== AccountStatementBuilder ==");
{
    var baseDate = new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero);

    // Farmer ledger mirroring the §5 example: one sale (net due 9,300), then a partial payment of 5,000.
    var farmerEntries = new[]
    {
        new AccountStatementBuilder.Entry(baseDate, "Sale INV-0001", 9_300m),
        new AccountStatementBuilder.Entry(baseDate.AddDays(3), "Payment to farmer", -5_000m),
    };
    var farmerStatement = AccountStatementBuilder.Build(farmerEntries);
    Check("farmer statement has 2 lines in date order", farmerStatement.Count == 2 &&
          farmerStatement[0].Description == "Sale INV-0001");
    Check("farmer running balance after sale = 9,300", farmerStatement[0].RunningBalance == 9_300m);
    Check("farmer remaining balance after payment = 4,300", farmerStatement[^1].RunningBalance == 4_300m,
          $"got {farmerStatement[^1].RunningBalance}");
    Check("RunningBalance(entries) matches last statement line",
          AccountStatementBuilder.RunningBalance(farmerEntries) == farmerStatement[^1].RunningBalance);

    // Out-of-order input must still be sorted by date before the running balance is computed.
    var outOfOrder = new[]
    {
        new AccountStatementBuilder.Entry(baseDate.AddDays(3), "Payment", -5_000m),
        new AccountStatementBuilder.Entry(baseDate, "Sale", 9_300m),
    };
    var sorted = AccountStatementBuilder.Build(outOfOrder);
    Check("entries are sorted by date regardless of input order", sorted[0].Description == "Sale");
}

Console.WriteLine();
Console.WriteLine($"RESULT: {passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;
