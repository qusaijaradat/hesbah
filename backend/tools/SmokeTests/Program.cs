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

Console.WriteLine("== The money identity: buyer - seller - driver == market ==");
{
    // The one invariant every money rule in this system has to satisfy, and the one that kept
    // quietly breaking: whatever the buyer hands over, minus what the seller is due, minus what
    // the driver is due, is exactly what stays with the market. Every past bug — سعر الخشب paid
    // to the seller and the driver at once, أجرة النقل charged to the buyer, crate fees missing
    // from the day profit — shows up here as the two sides failing to meet.
    //
    // Checked from the domain helpers themselves, never from a formula retyped here, so a rule
    // that changes in one of them and not the others fails this instead of shipping.
    void Identity(string name, decimal totalValue, decimal rate, decimal wood, decimal boxes,
                  decimal boxPrice, decimal driverBoxFee, decimal transport, bool hasDriver)
    {
        var commission = CommissionCalculator.Calculate(totalValue, rate).Commission;
        var boxFeeTotal = boxes * boxPrice;
        var driverBoxFeeTotal = boxes * driverBoxFee;

        var buyerPays = InvoiceCharge.ForMerchant(totalValue, wood, boxFeeTotal, returnsTotal: 0m);
        var sellerDue = InvoiceCharge.ForSeller(totalValue, commission, transport); // off the seller either way
        var driverDue = hasDriver ? InvoiceCharge.ForDriver(transport, driverBoxFeeTotal) : 0m;
        var market = MarketEarnings.ForInvoice(commission, boxFeeTotal, driverBoxFeeTotal, transport, wood, hasDriver);

        Check($"{name}: buyer - seller - driver == market",
              buyerPays - sellerDue - driverDue == market,
              $"buyer {buyerPays} - seller {sellerDue} - driver {driverDue} = {buyerPays - sellerDue - driverDue}, market says {market}");
    }

    // 400 boxes at ₪1 from the buyer and 0.3 to the driver — the split the owner set: the market
    // keeps 0.7 a box, ₪280 on this invoice, which is the figure that used to vanish entirely.
    Identity("with a driver", totalValue: 10_000m, rate: 0.10m, wood: 150m, boxes: 400m,
             boxPrice: 1m, driverBoxFee: 0.3m, transport: 200m, hasDriver: true);
    Identity("no driver (transport stays here)", totalValue: 10_000m, rate: 0.10m, wood: 150m, boxes: 400m,
             boxPrice: 1m, driverBoxFee: 0.3m, transport: 200m, hasDriver: false);
    Identity("nothing but produce", totalValue: 500m, rate: 0.10m, wood: 0m, boxes: 0m,
             boxPrice: 1m, driverBoxFee: 0.3m, transport: 0m, hasDriver: false);

    // The crate split itself, stated as its own fact rather than left implicit in the identity:
    // the buyer pays 1 a crate, the driver gets 0.3, and the remaining 0.7 is the market's.
    var kept = MarketEarnings.ForInvoice(commission: 0m, boxFeeTotal: 400m * 1m, driverBoxFeeTotal: 400m * 0.3m,
                                         transportFee: 0m, woodTotal: 0m, hasDriver: true);
    Check("400 crates at 1 out / 0.3 to the driver leaves the market 280", kept == 280m, $"got {kept}");

    // سعر الخشب is the market's outright — on the buyer's bill, on nobody else's.
    Check("wood is charged to the buyer",
          InvoiceCharge.ForMerchant(1_000m, woodTotal: 150m, boxFeeTotal: 0m, returnsTotal: 0m) == 1_150m);
    Check("wood is not deducted from the seller",
          InvoiceCharge.ForSeller(1_000m, commission: 100m, transportFee: 0m) == 900m);
    Check("wood stays with the market",
          MarketEarnings.ForInvoice(0m, 0m, 0m, 0m, woodTotal: 150m, hasDriver: true) == 150m);

    // أجرة النقل comes off the seller and goes to the driver — the buyer is not charged for it.
    Check("transport is not on the buyer's bill",
          InvoiceCharge.ForMerchant(1_000m, 0m, 0m, 0m) == 1_000m);
    Check("transport comes off the seller's due",
          InvoiceCharge.ForSeller(1_000m, commission: 100m, transportFee: 200m) == 700m);

    // A return hands back only the commission that had been earned on goods that did not sell.
    Check("a 1,000 return at 10% credits 100 of commission",
          MarketEarnings.CommissionCreditOnReturn(1_000m, 0.10m) == 100m);
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

    // An opening balance ("دين قديم" carried over from before the system) must show as its own
    // first line — the whole point is that the column adds up on screen instead of starting from
    // an unexplained number — and must not change the final remaining balance by doing so.
    var joined = baseDate.AddDays(-10);
    var withOpening = AccountStatementBuilder.Build(farmerEntries, 2_000m, joined);
    Check("opening balance adds one line at the top", withOpening.Count == farmerStatement.Count + 1 &&
          withOpening[0].Description == AccountStatementBuilder.OpeningBalanceDescription,
          $"got {withOpening.Count} lines starting with \"{withOpening[0].Description}\"");
    Check("opening line carries the amount and dates to the partner's join date",
          withOpening[0].SignedAmount == 2_000m && withOpening[0].RunningBalance == 2_000m && withOpening[0].Date == joined,
          $"got {withOpening[0].RunningBalance} on {withOpening[0].Date:yyyy-MM-dd}");
    Check("the column adds up: every line = previous balance + its own amount",
          withOpening.Skip(1).Select((l, i) => l.RunningBalance == withOpening[i].RunningBalance + l.SignedAmount).All(ok => ok));
    Check("remaining is still opening + sale - payment = 6,300",
          withOpening[^1].RunningBalance == 6_300m, $"got {withOpening[^1].RunningBalance}");
    Check("a zero opening balance adds no line at all",
          AccountStatementBuilder.Build(farmerEntries, 0m, joined).Count == farmerStatement.Count);
}

Console.WriteLine();
Console.WriteLine($"RESULT: {passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;
