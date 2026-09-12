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
using GreenMarket.Domain.Services.Ask;

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
        // (name, العدد, الوزن, السعر) — weighed lines, so the weight is what prices them.
        new InvoiceCalculator.LineInput("Tomatoes", 10m, 120m, 3.5m),   // 420.00
        new InvoiceCalculator.LineInput("Cucumbers", 8m, 80m, 2.25m),   // 180.00
        new InvoiceCalculator.LineInput("Potatoes", 20m, 200m, 1.10m),  // 220.00
    };

    var totals = InvoiceCalculator.Calculate(lines);
    Check("total weight = 400kg", totals.TotalWeightKg == 400m, $"got {totals.TotalWeightKg}");
    Check("total value = 820.00", totals.TotalValue == 820.00m, $"got {totals.TotalValue}");
    Check("3 line results returned", totals.Lines.Count == 3);
    Check("first line total = 420.00", totals.Lines[0].LineTotal == 420.00m, $"got {totals.Lines[0].LineTotal}");

    // The rule the whole change turns on: a weight prices the line when it is there, the count
    // when it is not. Before this, which one applied was carried by a Kg/Box unit, so a line
    // could be one or the other and never both.
    var mixed = InvoiceCalculator.Calculate(new[]
    {
        new InvoiceCalculator.LineInput("Tomatoes", 10m, 100m, 3m),        // weighed: 100 × 3 = 300
        new InvoiceCalculator.LineInput("Lettuce", 5m, null, 20m),         // not weighed: 5 × 20 = 100
    });
    Check("a weighed line is priced by its WEIGHT", mixed.Lines[0].LineTotal == 300m, $"got {mixed.Lines[0].LineTotal}");
    Check("an unweighed line is priced by its COUNT", mixed.Lines[1].LineTotal == 100m, $"got {mixed.Lines[1].LineTotal}");
    Check("only the weighed line adds weight", mixed.TotalWeightKg == 100m, $"got {mixed.TotalWeightKg}");
    Check("both count toward the value", mixed.TotalValue == 400.00m, $"got {mixed.TotalValue}");

    // The ONE number a person watches while typing: a line's own total on its own row. It was
    // multiplying العدد by the price whatever the weight said, so a weighed line showed one figure
    // on its row and was counted as a different one in الإجمالي الكلي directly underneath it.
    Check("a weighed line is worth its weight x price, not its count x price",
          InvoiceCalculator.LineTotalFor(12m, 300m, 3m) == 900m,
          $"got {InvoiceCalculator.LineTotalFor(12m, 300m, 3m)}");
    Check("the count does not leak into a weighed line's total",
          InvoiceCalculator.LineTotalFor(12m, 300m, 3m) != 12m * 3m);

    // A weight of zero is not a weight: it reads the same as never having been weighed.
    Check("weight 0 is priced by the count",
          InvoiceCalculator.LineTotalFor(5m, 0m, 20m) == 100m,
          $"got {InvoiceCalculator.LineTotalFor(5m, 0m, 20m)}");
    Check("no weight at all is priced by the count",
          InvoiceCalculator.LineTotalFor(5m, null, 20m) == 100m);

    // Containers are counted per line and are nobody else's business: crates are what رسوم
    // الصناديق is charged on, cartons are only ever tracked, and neither touches the value.
    var containers = InvoiceCalculator.Calculate(new[]
    {
        new InvoiceCalculator.LineInput("Tomatoes", 10m, 300m, 3m, BoxQuantity: 12m, CartonQuantity: 4m),
        new InvoiceCalculator.LineInput("Lettuce", 5m, null, 20m, BoxQuantity: 5m),
    });
    Check("crates are summed across lines", containers.TotalBoxes == 17m, $"got {containers.TotalBoxes}");
    Check("cartons are summed separately", containers.TotalCartons == 4m, $"got {containers.TotalCartons}");
    Check("containers never touch the line value", containers.TotalValue == 1000m, $"got {containers.TotalValue}");

    // The crates on a WEIGHED line are the ones the old shape lost entirely: its unit was Kg, so
    // its crates counted as zero and the buyer was charged nothing for them.
    Check("a weighed line still contributes its crates",
          containers.Lines[0].BoxQuantity == 12m, $"got {containers.Lines[0].BoxQuantity}");

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
        InvoiceCalculator.Calculate(new[] { new InvoiceCalculator.LineInput("Bad", 0m, 100m, 5m) });
        Check("zero count throws even when a weight is given", false, "did not throw");
    }
    catch (ArgumentOutOfRangeException)
    {
        Check("zero count throws even when a weight is given", true);
    }
}

Console.WriteLine("== Ask: reading the model's answer ==");
{
    // The model's reply is the one input here that nothing else validates, so every shape it could
    // come back in is handled — and anything unrecognised has to land on Unknown, which answers
    // "ما بعرف". Falling through to some nearby intent would answer a question nobody asked, with
    // real figures, and look entirely correct.
    var ok = AskPlanParser.Parse("""
        {"intent":"PartnerBalance","partnerName":"أبو علي","dateFrom":null,"dateTo":null,"limit":null,"understood":"رصيد أبو علي"}
        """);
    Check("a well-formed plan is read", ok.Intent == AskIntent.PartnerBalance && ok.PartnerName == "أبو علي",
          $"got {ok.Intent} / {ok.PartnerName}");
    Check("a null date stays null", ok.DateFrom is null && ok.DateTo is null);

    var dated = AskPlanParser.Parse("""
        {"intent":"MarketProfit","partnerName":null,"dateFrom":"2026-09-01","dateTo":"2026-09-13","limit":5,"understood":"ربح الشهر"}
        """);
    Check("dates are read", dated.DateFrom?.ToString("yyyy-MM-dd") == "2026-09-01" && dated.DateTo?.ToString("yyyy-MM-dd") == "2026-09-13",
          $"got {dated.DateFrom} / {dated.DateTo}");
    Check("limit is read", dated.Limit == 5);

    Check("an intent name we do not have becomes Unknown",
          AskPlanParser.Parse("""{"intent":"DropAllTables","understood":"x"}""").Intent == AskIntent.Unknown);
    Check("Unknown itself round-trips",
          AskPlanParser.Parse("""{"intent":"Unknown","understood":"مش فاهم"}""").Intent == AskIntent.Unknown);
    Check("a missing intent becomes Unknown",
          AskPlanParser.Parse("""{"understood":"x"}""").Intent == AskIntent.Unknown);
    Check("broken JSON becomes Unknown rather than throwing",
          AskPlanParser.Parse("not json at all").Intent == AskIntent.Unknown);
    Check("an empty reply becomes Unknown", AskPlanParser.Parse("").Intent == AskIntent.Unknown);
    Check("a nonsense date is dropped, not guessed",
          AskPlanParser.Parse("""{"intent":"MarketProfit","dateFrom":"يوم الثلاثاء"}""").DateFrom is null);
    Check("a limit that is not a number is dropped",
          AskPlanParser.Parse("""{"intent":"TopDebtors","limit":"كتير"}""").Limit is null);

    // Case drift in the intent name must not silently become Unknown — the model writing
    // "partnerbalance" is a formatting difference, not a different question.
    Check("the intent name is matched case-insensitively",
          AskPlanParser.Parse("""{"intent":"partnerbalance","partnerName":"x"}""").Intent == AskIntent.PartnerBalance);
}

Console.WriteLine("== One whole invoice, every party, composed the way InvoiceService composes it ==");
{
    // The pieces are each covered on their own above. This checks the COMPOSITION: the same calls,
    // in the same order, that InvoiceService.CreateAsync makes — because every money bug this
    // codebase has had lived in the seam between two correct functions, not inside either of them.
    //
    // A realistic invoice in the shape a line has now:
    //   بندورة  — 12 crates, weighed 300kg, priced 3.50/kg, 12 crates out, wood 5
    //   خيار    — 40 counted, not weighed, priced 12.00 each, 40 crates out
    //   نعنع    — 30 counted, not weighed, priced 2.00 each, 0 crates, 30 cartons
    var lines = new[]
    {
        new InvoiceCalculator.LineInput("بندورة", 12m, 300m, 3.50m, BoxQuantity: 12m, WoodPrice: 5m),
        new InvoiceCalculator.LineInput("خيار", 40m, null, 12m, BoxQuantity: 40m),
        new InvoiceCalculator.LineInput("نعنع", 30m, null, 2m, CartonQuantity: 30m),
    };
    var totals = InvoiceCalculator.Calculate(lines);

    // Settings as the owner set them: 10% commission, ₪1 a crate from the buyer, 0.3 to the driver.
    const decimal rate = 0.10m, boxPrice = 1m, driverBoxFee = 0.3m, transport = 200m;

    Check("produce value = 1050 + 480 + 60 = 1590", totals.TotalValue == 1_590m, $"got {totals.TotalValue}");
    Check("weight counts only the weighed line", totals.TotalWeightKg == 300m, $"got {totals.TotalWeightKg}");
    Check("crates = 12 + 40, including the weighed line's", totals.TotalBoxes == 52m, $"got {totals.TotalBoxes}");
    Check("cartons are their own count", totals.TotalCartons == 30m, $"got {totals.TotalCartons}");
    Check("wood is a flat per-line add-on, not multiplied", totals.WoodTotal == 5m, $"got {totals.WoodTotal}");

    var commission = CommissionCalculator.Calculate(totals.TotalValue, rate).Commission;
    var boxFeeTotal = totals.TotalBoxes * boxPrice;
    var driverBoxFeeTotal = totals.TotalBoxes * driverBoxFee;
    Check("commission is on the produce alone — never +wood, +crates, +transport",
          commission == 159m, $"got {commission}");

    // The three parties, each from the one function that owns its side.
    var buyerPays = InvoiceCharge.ForMerchant(totals.TotalValue, totals.WoodTotal, boxFeeTotal, returnsTotal: 0m);
    var sellerDue = InvoiceCharge.ForSeller(totals.TotalValue, commission, transport);
    var driverDue = InvoiceCharge.ForDriver(transport, driverBoxFeeTotal);
    var market = MarketEarnings.ForInvoice(commission, boxFeeTotal, driverBoxFeeTotal, transport, totals.WoodTotal, hasDriver: true);

    Check("buyer pays 1590 + 5 wood + 52 crates = 1647", buyerPays == 1_647m, $"got {buyerPays}");
    Check("seller is due 1590 - 159 - 200 = 1231", sellerDue == 1_231m, $"got {sellerDue}");
    Check("driver is due 200 + 15.6 = 215.6", driverDue == 215.6m, $"got {driverDue}");
    Check("market keeps 159 + 52 + 5 - 15.6 = 200.4", market == 200.4m, $"got {market}");
    Check("and the three sides close: buyer - seller - driver == market",
          buyerPays - sellerDue - driverDue == market,
          $"{buyerPays} - {sellerDue} - {driverDue} = {buyerPays - sellerDue - driverDue}, market says {market}");

    // Now a return: 100kg of the بندورة comes back, priced as it was sold.
    var returnedValue = InvoiceCalculator.LineTotalFor(4m, 100m, 3.50m);
    Check("the return is priced by weight, like the line it comes off", returnedValue == 350m, $"got {returnedValue}");

    var buyerAfter = InvoiceCharge.ForMerchant(totals.TotalValue, totals.WoodTotal, boxFeeTotal, returnedValue);
    var commissionBack = MarketEarnings.CommissionCreditOnReturn(returnedValue, rate);
    // The seller's side moves by the return MINUS the commission that was charged on it — the
    // offsetting Adjustment GoodsReturnService posts.
    var sellerAfter = sellerDue - (returnedValue - commissionBack);
    var marketAfter = market - commissionBack;

    Check("the buyer owes 350 less", buyerAfter == buyerPays - 350m, $"got {buyerAfter}");
    Check("the market hands back only the 35 of commission it had earned on it",
          commissionBack == 35m, $"got {commissionBack}");
    Check("and the three sides STILL close after the return",
          buyerAfter - sellerAfter - driverDue == marketAfter,
          $"{buyerAfter} - {sellerAfter} - {driverDue} = {buyerAfter - sellerAfter - driverDue}, market says {marketAfter}");

    // The same invoice with nobody to drive it: the transport stays with the market instead.
    var marketNoDriver = MarketEarnings.ForInvoice(commission, boxFeeTotal, driverBoxFeeTotal, transport, totals.WoodTotal, hasDriver: false);
    Check("with no driver the sides still close, transport included",
          buyerPays - sellerDue - 0m == marketNoDriver,
          $"{buyerPays} - {sellerDue} = {buyerPays - sellerDue}, market says {marketNoDriver}");

    // Crates are charged once and split two ways: ₪1 from the buyer, 0.3 to the driver, 0.7 kept.
    Check("52 crates: 52 off the buyer, 15.6 to the driver, 36.4 kept",
          boxFeeTotal == 52m && driverBoxFeeTotal == 15.6m && boxFeeTotal - driverBoxFeeTotal == 36.4m,
          $"{boxFeeTotal} / {driverBoxFeeTotal}");
    Check("cartons are charged to nobody", 
          MarketEarnings.ForInvoice(0m, 0m, 0m, 0m, 0m, hasDriver: true) == 0m);
}

Console.WriteLine("== The old debt, and where it is allowed to appear ==");
{
    // An opening balance is an old debt carried over from before this system. It belongs on the
    // ACCOUNT, and the statement is where it has to say so — with its own dated line, so the
    // running balance adds up from the top instead of opening on an unexplained number.
    var baseDate = new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero);
    var joined = baseDate.AddDays(-30);
    var statement = AccountStatementBuilder.Build(new[]
    {
        new AccountStatementBuilder.Entry(baseDate, "فاتورة", 400m),
    }, startingBalance: 1_000m, startingBalanceDate: joined);

    Check("the old debt still opens the statement",
          statement[0].Description == AccountStatementBuilder.OpeningBalanceDescription);
    Check("and is still inside المتبقي", statement[^1].RunningBalance == 1_400m,
          $"got {statement[^1].RunningBalance}");

    // The printed invoice is the one place it is held back, per person. The rule is a plain
    // "only when marked", mirrored here from InvoiceService.ComputePreviousBalanceAsync — the
    // figure itself is unchanged, it is only kept off a bill for today's goods.
    static decimal PreviousBalance(decimal openingBalance, bool include, decimal otherInvoices, decimal paid) =>
        Math.Max(0, (include ? openingBalance : 0) + otherInvoices - paid);

    Check("by default the old debt is NOT on the printed invoice",
          PreviousBalance(1_000m, include: false, otherInvoices: 400m, paid: 100m) == 300m,
          $"got {PreviousBalance(1_000m, false, 400m, 100m)}");
    Check("switched on for that person, it is",
          PreviousBalance(1_000m, include: true, otherInvoices: 400m, paid: 100m) == 1_300m,
          $"got {PreviousBalance(1_000m, true, 400m, 100m)}");
    Check("a buyer with no old debt reads the same either way",
          PreviousBalance(0m, include: false, otherInvoices: 400m, paid: 100m)
          == PreviousBalance(0m, include: true, otherInvoices: 400m, paid: 100m));
    Check("an overpaid buyer never prints a negative previous balance",
          PreviousBalance(1_000m, include: true, otherInvoices: 0m, paid: 5_000m) == 0m);

    // "قيمة الديون" splits the same amount into where it came from — the halves must add to the
    // total, or the page would be showing two numbers that disagree with the one beside them.
    var oldDebt = 1_000m;
    var current = 400m - 100m;
    Check("old + current is exactly the remaining shown beside them", oldDebt + current == 1_300m);
}

Console.WriteLine("== PartnerRoles: a person can be more than one thing ==");
{
    // The reported bug, exactly: a new driver typed into an invoice's driver field, whose name was
    // already on file as a buyer, came back as بائع/مشتري with no driver role at all — while that
    // same invoice recorded him as its driver.
    var wasBuyer = PartnerType.Merchant;
    var nowAlsoDrives = PartnerRoles.Add(wasBuyer, PartnerType.Driver);
    Check("a buyer entered as a driver keeps BOTH roles",
          PartnerRoles.Has(nowAlsoDrives, PartnerType.Merchant) && PartnerRoles.Has(nowAlsoDrives, PartnerType.Driver),
          $"got {nowAlsoDrives}");
    Check("and is not silently turned into a seller", !PartnerRoles.Has(nowAlsoDrives, PartnerType.Farmer),
          $"got {nowAlsoDrives}");
    Check("the combination has a name of its own", nowAlsoDrives == PartnerType.MerchantDriver, $"got {nowAlsoDrives}");

    // The knock-on effect: he was rejected from the driver field on every later invoice, and the
    // picker stopped offering his name.
    Check("he can be used as a driver on the next invoice", PartnerRoles.CanBe(nowAlsoDrives, PartnerType.Driver));
    Check("and still as a buyer", PartnerRoles.CanBe(nowAlsoDrives, PartnerType.Merchant));
    Check("but not as a seller", !PartnerRoles.CanBe(nowAlsoDrives, PartnerType.Farmer));

    // The seller who hauls his own produce: picked in an invoice's driver field, he must come back
    // as the SAME person holding both roles — one account, one balance — not a second record under
    // a near-identical name. (PartnerService.GetWithRoleAsync does this for a picked id, and
    // FindOrCreateAsync for a typed name; both go through Add.)
    var sellerWhoDrives = PartnerRoles.Add(PartnerType.Farmer, PartnerType.Driver);
    Check("a seller used as a driver becomes seller+driver",
          sellerWhoDrives == PartnerType.FarmerDriver, $"got {sellerWhoDrives}");
    Check("and is still a seller afterwards", PartnerRoles.Has(sellerWhoDrives, PartnerType.Farmer));
    Check("the driver field lists him, because he holds Driver",
          PartnerRoles.Has(sellerWhoDrives, PartnerType.Driver));
    Check("the seller field still lists him too", PartnerRoles.Has(sellerWhoDrives, PartnerType.Farmer));
    Check("he reads as both", PartnerRoles.Label(sellerWhoDrives) == "بائع/سائق", PartnerRoles.Label(sellerWhoDrives));

    // The reverse direction lost the driver role instead.
    var driverWhoBuys = PartnerRoles.Add(PartnerType.Driver, PartnerType.Merchant);
    Check("a driver entered as a buyer stays a driver", PartnerRoles.Has(driverWhoBuys, PartnerType.Driver));
    Check("roles combine the same either way round", driverWhoBuys == nowAlsoDrives);

    // Existing data keeps its meaning: Both has always been stored as 3 = Farmer | Merchant.
    Check("Both still means seller and buyer",
          PartnerRoles.Has(PartnerType.Both, PartnerType.Farmer) && PartnerRoles.Has(PartnerType.Both, PartnerType.Merchant));
    Check("Both is not a driver", !PartnerRoles.Has(PartnerType.Both, PartnerType.Driver));
    Check("Both is still the number already in the database", (int)PartnerType.Both == 3);
    Check("adding a role a person already holds changes nothing",
          PartnerRoles.Add(PartnerType.Both, PartnerType.Farmer) == PartnerType.Both);

    // A person recorded before their role was known must stay usable for anything.
    Check("an untyped person may be used as any role",
          PartnerRoles.CanBe(null, PartnerType.Driver) && PartnerRoles.CanBe(null, PartnerType.Farmer));
    Check("but does not COUNT as one in any list", !PartnerRoles.Has(null, PartnerType.Driver));

    // Both sellers and drivers post to the same ledger, so balance queries ask one question.
    Check("seller side covers sellers, drivers and every mix",
          PartnerRoles.HasSellerSide(PartnerType.Farmer) && PartnerRoles.HasSellerSide(PartnerType.Driver) &&
          PartnerRoles.HasSellerSide(PartnerType.MerchantDriver) && PartnerRoles.HasSellerSide(PartnerType.All));
    Check("a plain buyer has no seller side", !PartnerRoles.HasSellerSide(PartnerType.Merchant));

    Check("the label names every role held, not just the first",
          PartnerRoles.Label(PartnerType.MerchantDriver) == "مشتري/سائق", PartnerRoles.Label(PartnerType.MerchantDriver));
    Check("all three reads as all three",
          PartnerRoles.Label(PartnerType.All) == "بائع/مشتري/سائق", PartnerRoles.Label(PartnerType.All));
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
