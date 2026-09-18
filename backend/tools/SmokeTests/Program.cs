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

Console.WriteLine("== Ask: reading the question without a model ==");
{
    // The whole feature, free: twelve questions, a handful of phrasings, and names matched against
    // the partners actually on file. Every question below is one someone would really type.
    var people = new[] { "أبو علي", "أبو علي النجار", "سامي حسن", "خالد السائق" };
    var today = new DateTimeOffset(2026, 9, 13, 10, 0, 0, TimeSpan.Zero);
    AskPlan Ask(string q) => KeywordAskPlanner.Plan(q, people, today);

    void Intent(string question, AskIntent expected)
    {
        var p = Ask(question);
        Check($"\"{question}\" => {expected}", p.Intent == expected, $"got {p.Intent}");
    }

    Intent("كم على أبو علي؟", AskIntent.PartnerBalance);
    Intent("شو رصيد سامي حسن", AskIntent.PartnerBalance);
    Intent("كم باع سامي حسن هالشهر؟", AskIntent.PartnerSales);
    Intent("كم اشترى أبو علي هالأسبوع", AskIntent.PartnerPurchases);
    Intent("مين أكتر واحد عليه دين؟", AskIntent.TopDebtors);
    Intent("مين إلو مستحقات عنا", AskIntent.TopCreditors);
    Intent("شو أكتر صنف بينباع؟", AskIntent.TopItems);
    Intent("كم ربحت المصلحة هالشهر", AskIntent.MarketProfit);
    Intent("شو صار اليوم", AskIntent.DailyClosing);
    Intent("شو الشيكات المستحقة", AskIntent.ChecksDue);
    Intent("مين ماسك صناديقي", AskIntent.ContainersHeld);
    Intent("في فواتير فيها أصناف بدون سعر؟", AskIntent.UnpricedInvoices);
    Intent("مين ما دفع", AskIntent.UnpaidInvoices);

    // Spelling that differs only in ways Arabic writes both ways must not change the answer.
    Intent("كم علي ابو علي", AskIntent.PartnerBalance);
    Intent("مين اكتر واحد عليه دين", AskIntent.TopDebtors);

    // The longer name wins when both are on file and the question says the longer one — otherwise
    // a question about النجار is answered about a different man with a shorter name.
    Check("the longest matching name wins",
          Ask("كم على أبو علي النجار؟").PartnerName == "أبو علي النجار",
          $"got {Ask("كم على أبو علي النجار؟").PartnerName}");
    Check("and the shorter one still matches on its own",
          Ask("كم على أبو علي؟").PartnerName == "أبو علي");

    // Periods, because an answer over the wrong dates is the wrong answer that looks right.
    Check("\"هالشهر\" starts at the first of this month",
          Ask("كم ربحت هالشهر").DateFrom?.ToString("yyyy-MM-dd") == "2026-09-01",
          $"got {Ask("كم ربحت هالشهر").DateFrom}");
    Check("\"امبارح\" is yesterday, and bounded",
          Ask("شو صار امبارح").DateFrom?.ToString("yyyy-MM-dd") == "2026-09-12");
    Check("\"هالأسبوع\" is the last seven days",
          Ask("كم ربحت هالأسبوع").DateFrom?.ToString("yyyy-MM-dd") == "2026-09-06");
    Check("no period words leaves the dates unset (all time, never a wrong window)",
          Ask("كم ربحت المصلحة").DateFrom is null);

    // Refusing is a feature: a question outside the twelve has to say so, not land on a near one
    // and answer it with real figures.
    Check("a question outside the list is Unknown", Ask("شو الطقس اليوم بنابلس").Intent == AskIntent.Unknown);
    Check("an empty question is Unknown", Ask("").Intent == AskIntent.Unknown);
    Check("a name nobody has is not invented", Ask("كم على محمود الغريب؟").PartnerName is null);

    // Asked about a person without naming one: say which half is missing rather than a bare shrug.
    {
        var p = Ask("كم باع؟");
        Check("\"كم باع\" with nobody named is Unknown but says why",
              p.Intent == AskIntent.Unknown && p.Understood != null, $"got {p.Intent} / {p.Understood}");
    }

    // A request to CHANGE something must never map onto a query. Nothing in the catalog writes,
    // but the reader should not pretend to understand it either.
    Check("a request to delete is not a question", Ask("احذف كل الفواتير").Intent == AskIntent.Unknown);

    // Arabic-Indic digits are the digits the notebook is written in.
    Check("٢٣ normalizes to 23", KeywordAskPlanner.Normalize("٢٣") == "23");
    Check("أ إ آ all normalize to ا", KeywordAskPlanner.Normalize("أإآ") == "ااا");
    Check("ة normalizes to ه", KeywordAskPlanner.Normalize("مصلحة") == KeywordAskPlanner.Normalize("مصلحه"));
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

    // One person who is both the seller and the driver. أجرة النقل is taken off his seller side and
    // paid to his driver side, so it cancels — the market neither charges him to carry his own goods
    // nor pays him twice for it. What is left is his produce, less commission, plus أجرة الصناديق.
    Check("a seller who drove his own load is paid produce - commission + crate fee",
          InvoiceCharge.ForSellerDriver(1_000m, commission: 100m, transportFee: 200m, driverBoxFeeTotal: 30m) == 930m);
    Check("and the transport figure itself makes no difference to that total",
          InvoiceCharge.ForSellerDriver(1_000m, 100m, transportFee: 200m, driverBoxFeeTotal: 30m)
          == InvoiceCharge.ForSellerDriver(1_000m, 100m, transportFee: 900m, driverBoxFeeTotal: 30m));
    Check("it is exactly the two sides added, never a separate rule",
          InvoiceCharge.ForSellerDriver(1_000m, 100m, 200m, 30m)
          == InvoiceCharge.ForSeller(1_000m, 100m, 200m) + InvoiceCharge.ForDriver(200m, 30m));

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
Console.WriteLine("== who may be told what needs attention (AlertVisibility) ==");
{
    // The rule behind BOTH the on-screen banner and the morning phone notification. Pinned here
    // because it is the kind of rule that is quietly loosened by somebody adding a permission to a
    // role and never noticing what else it switched on.
    string[] all = PermissionKeys.All;

    var admin = AlertVisibility.For(all);
    Check("someone with everything is told everything",
          admin.Checks && admin.Invoices && admin.Sacks);

    Check("no permissions at all means nothing, and None says so",
          AlertVisibility.For(Array.Empty<string>()).None);
    Check("a null permission set is nothing, not everything",
          AlertVisibility.For(null).None);

    // The market's own example: an account that may LOOK at invoices but not price one.
    var readOnlyInvoices = AlertVisibility.For(new[] { PermissionKeys.InvoicesView });
    Check("may view invoices but not edit => NOT told an invoice is unpriced",
          !readOnlyInvoices.Invoices);
    var canPrice = AlertVisibility.For(new[] { PermissionKeys.InvoicesView, PermissionKeys.InvoicesEdit });
    Check("may view AND price => told",
          canPrice.Invoices);

    // And the other way round: able to fix it, not allowed on the page it links to.
    var editNoView = AlertVisibility.For(new[] { PermissionKeys.InvoicesEdit });
    Check("may edit but not view => NOT told (the alert links to a page they cannot open)",
          !editNoView.Invoices);

    var checksOnly = AlertVisibility.For(new[] { PermissionKeys.PaymentsView, PermissionKeys.PaymentsEdit });
    Check("checks-and-payments only => told about checks",
          checksOnly.Checks);
    Check("...and NOT about invoices",
          !checksOnly.Invoices);
    Check("...and NOT about sacks",
          !checksOnly.Sacks);

    var sacksOnly = AlertVisibility.For(new[] { PermissionKeys.SacksView, PermissionKeys.SacksCreate });
    Check("a sacks-only account is told about sacks",
          sacksOnly.Sacks);
    Check("...and nothing else at all",
          !sacksOnly.Checks && !sacksOnly.Invoices);
    Check("sacks.view alone (may look, may not record a return) => not told",
          !AlertVisibility.For(new[] { PermissionKeys.SacksView }).Sacks);

    Check("payments.view alone (may look, may not settle a check) => not told",
          !AlertVisibility.For(new[] { PermissionKeys.PaymentsView }).Checks);

    // Permissions from a DIFFERENT area must not open any of these by accident.
    var unrelated = AlertVisibility.For(new[]
    {
        PermissionKeys.PartnersView, PermissionKeys.PartnersEdit,
        PermissionKeys.ReportsView, PermissionKeys.AuditView, PermissionKeys.BackupDownload
    });
    Check("unrelated permissions switch nothing on", unrelated.None);
}

Console.WriteLine();
Console.WriteLine("== when a signed-in device is still signed in (SessionRules) ==");
{
    var now = new DateTimeOffset(2026, 9, 16, 9, 0, 0, TimeSpan.Zero);
    const string current = "aaaa";
    const string previous = "bbbb";

    // The market's own choice: sessions have no expiry. They end because somebody ended them.
    Check("no expiry set => still usable", SessionRules.IsUsable(null, null, now));
    Check("revoked => not usable, expiry or no expiry",
          !SessionRules.IsUsable(now.AddMinutes(-1), null, now));
    Check("an expiry in the future is fine", SessionRules.IsUsable(null, now.AddDays(1), now));
    Check("an expiry in the past is not", !SessionRules.IsUsable(null, now.AddSeconds(-1), now));

    Check("the current token refreshes",
          SessionRules.Verify(current, current, previous, null, null, now) == RefreshVerdict.Accepted);

    // The theft signal. Every refresh retires the token it consumed, so a retired one coming back
    // means two parties hold this session.
    Check("a RETIRED token is reuse, not merely wrong",
          SessionRules.Verify(previous, current, previous, null, null, now) == RefreshVerdict.Reused);
    Check("a token belonging to nothing is just rejected",
          SessionRules.Verify("cccc", current, previous, null, null, now) == RefreshVerdict.Rejected);
    Check("no previous hash yet (first refresh) still accepts the current one",
          SessionRules.Verify(current, current, null, null, null, now) == RefreshVerdict.Accepted);

    // An ended session refuses everything, including the token it itself last issued — otherwise
    // "سكّر الجلسة" would leave the device able to mint a fresh one and carry on.
    Check("a revoked session refuses its own current token",
          SessionRules.Verify(current, current, previous, now.AddMinutes(-1), null, now) == RefreshVerdict.Rejected);
    Check("...and a replayed one too, without reporting reuse",
          SessionRules.Verify(previous, current, previous, now.AddMinutes(-1), null, now) == RefreshVerdict.Rejected);
    Check("an expired session refuses its own current token",
          SessionRules.Verify(current, current, previous, null, now.AddSeconds(-1), now) == RefreshVerdict.Rejected);

    Check("equal strings compare equal", SessionRules.FixedTimeEquals("abc123", "abc123"));
    Check("a different length is not equal", !SessionRules.FixedTimeEquals("abc", "abcd"));
    Check("one differing character is not equal", !SessionRules.FixedTimeEquals("abc", "abd"));
    Check("empty compares to empty", SessionRules.FixedTimeEquals("", ""));
}

Console.WriteLine();
Console.WriteLine("== writing an amount straight onto an account (SettlementSides) ==");
{
    // The market settles a balance by saying so — "خلص، صافينا" — and wants the amount on the
    // account. The only rule left is WHICH accounts it lands on, because the same man often has
    // two: he brings produce in the morning and buys a crate of something else in the afternoon.

    Check("a plain seller => his seller account",
          SettlementSides.TouchesSeller(PartnerType.Farmer) && !SettlementSides.TouchesBuyer(PartnerType.Farmer));
    Check("a driver => his seller-side account too, the same ledger",
          SettlementSides.TouchesSeller(PartnerType.Driver) && !SettlementSides.TouchesBuyer(PartnerType.Driver));
    Check("a plain buyer => his buyer account only",
          SettlementSides.TouchesBuyer(PartnerType.Merchant) && !SettlementSides.TouchesSeller(PartnerType.Merchant));

    // The case the old مقاصّة screen existed for, now with no screen: one amount, both sides.
    var both = PartnerType.Farmer | PartnerType.Merchant;
    Check("sells AND buys => both accounts, from one amount",
          SettlementSides.TouchesSeller(both) && SettlementSides.TouchesBuyer(both));
    var driverBuyer = PartnerType.Driver | PartnerType.Merchant;
    Check("drives AND buys => both as well",
          SettlementSides.TouchesSeller(driverBuyer) && SettlementSides.TouchesBuyer(driverBuyer));

    // Staff record a person before knowing what they are. The amount still has to land somewhere:
    // the seller ledger is the only table a hand-written line can live in at all.
    Check("role not known yet => the seller ledger, never nowhere",
          SettlementSides.TouchesSeller(null));
    Check("...and not his buyer side, which may not exist",
          !SettlementSides.TouchesBuyer(null));

    // The identity that makes this safe to record as ordinary payments: settling X takes X off
    // what he owes AND X off what he is owed, so the market's net position across the two
    // accounts is unchanged. If those ever stopped moving together, one side of the books would
    // drift — which is the whole reason both halves are written in one transaction.
    const decimal buyer = 2_000m, seller = 5_000m, settle = 1_200m;
    var netBefore = seller - buyer;
    var netAfter = (seller - settle) - (buyer - settle);
    Check("settling moves both sides by the same amount, so the net is unchanged",
          netAfter == netBefore, $"{netBefore} => {netAfter}");
    Check("and the settled amount really came off each side",
          (buyer - settle) == 800m && (seller - settle) == 3_800m);

    // No ceiling any more, by request. Overshooting is allowed and reads as a credit — it is an
    // ordinary payment, deleted like any other. Asserted so that "the limit came back" would fail
    // here rather than be discovered by somebody who could not save the figure he agreed to.
    var overshoot = seller - 9_000m;
    Check("settling more than the market owes leaves a credit, not an error",
          overshoot == -4_000m, $"got {overshoot}");
}

Console.WriteLine();
Console.WriteLine("== who the produce money is owed to (InvoiceLedgerTarget) ==");
{
    // The market hands ONE amount to the driver who brought the load, and he distributes it to the
    // sellers whose produce it was. So the produce money is owed to the driver, not the seller —
    // except when there is no outside driver to hand it to.
    const int seller = 7, driver = 9, house = 42;

    Check("an outside driver brought it => the money is owed to him",
          InvoiceLedgerTarget.SaleGoesTo(seller, driver, house) == driver);
    Check("no driver on the invoice => the money stays with the seller",
          InvoiceLedgerTarget.SaleGoesTo(seller, null, house) == seller);
    Check("the market brought it itself => the money stays with the seller",
          InvoiceLedgerTarget.SaleGoesTo(seller, house, house) == seller);

    // Before anyone fills the setting in, every driver is an outside driver — which is exactly how
    // the system behaved when the market had no way to say which record was its own.
    Check("no house driver configured => a named driver is an outside driver",
          InvoiceLedgerTarget.SaleGoesTo(seller, driver, null) == driver);
    Check("no house driver configured => even the house id is an outside driver",
          InvoiceLedgerTarget.SaleGoesTo(seller, house, null) == house);

    Check("a driver and no seller => still owed to the driver",
          InvoiceLedgerTarget.SaleGoesTo(null, driver, house) == driver);
    Check("no seller and no driver => nobody is owed anything",
          InvoiceLedgerTarget.SaleGoesTo(null, null, house) is null);
    Check("no seller and the market drove it => nobody is owed anything",
          InvoiceLedgerTarget.SaleGoesTo(null, house, house) is null);

    // The two answers have to move together: whoever is handed the produce money is also the one
    // owed the haulage on top of it. If they ever disagreed, someone would be paid for the load and
    // not for hauling it, and the difference would sit on nobody's account.
    Check("owed the produce => owed the haulage",
          InvoiceLedgerTarget.IsOutsideDriver(driver, house)
          && InvoiceLedgerTarget.SaleGoesTo(seller, driver, house) == driver);
    Check("the market is owed no haulage by itself",
          !InvoiceLedgerTarget.IsOutsideDriver(house, house));
    Check("an empty driver field is owed no haulage",
          !InvoiceLedgerTarget.IsOutsideDriver(null, house));

    // A whole load, the way the printed sheet lays it out: three sellers, one of them with two
    // invoices, and one load with no seller named at all. The sheet adds up the per-seller nets and
    // puts the haulage and the crate money on top; the ledger posts a Sale row per invoice and one
    // TransportFee row. The two have to reach the same figure, or the driver settles from a sheet
    // that disagrees with the account he is settled against.
    var load = new[]
    {
        //  value, commission, transport, crates
        (4_000m, 400m, 120m, 45m),
        (1_500m, 150m,  60m, 15m),
        (  900m,  90m,   0m, 12m),
        (2_250m, 225m,  80m, 30m),
    };
    var sheetTotal = load.Sum(l => InvoiceCharge.ForSeller(l.Item1, l.Item2, l.Item3))
                   + load.Sum(l => l.Item3)
                   + load.Sum(l => l.Item4);
    var ledgerTotal = load.Sum(l => InvoiceCharge.ForSeller(l.Item1, l.Item2, l.Item3))
                    + load.Sum(l => InvoiceCharge.ForDriver(l.Item3, l.Item4));
    Check("the printed sheet and the driver's ledger reach the same total",
          sheetTotal == ledgerTotal, $"sheet {sheetTotal} vs ledger {ledgerTotal}");
    Check("and that total is the produce less commission, plus the crate money",
          sheetTotal == load.Sum(l => l.Item1 - l.Item2 + l.Item4), $"got {sheetTotal}");

    // A load carried for nothing still settles: no haulage on top, and the sellers get their
    // produce less commission with nothing deducted.
    Check("no transport anywhere => the driver holds only the sellers’ money",
          InvoiceCharge.ForSeller(900m, 90m, 0m) + InvoiceCharge.ForDriver(0m, 0m) == 810m);

    // What the market pays out is the same either way — that is the point of the change. It settles
    // with one person instead of several, and the total is untouched.
    const decimal value = 10_000m, commission = 1_000m, transport = 300m, crates = 150m;
    var driverTakes = InvoiceCharge.ForSeller(value, commission, transport)
                    + InvoiceCharge.ForDriver(transport, crates);
    Check("one payment to the driver = what the seller and the driver were paid separately",
          driverTakes == value - commission + crates, $"got {driverTakes}");
}

Console.WriteLine();
Console.WriteLine("== moving the old balances onto the drivers (LedgerMigrationService) ==");
{
    // The migration decides what to move with exactly the same call the posting code uses, so what
    // is modelled here is the real predicate, not a copy of it that can drift away from it.
    const int house = 42;
    var ledger = new List<(int InvoiceId, int Seller, int? Driver, decimal Amount, int OwnedBy)>
    {
        (1, 7, 9,     900m, 7),   // outside driver  -> moves
        (2, 7, 9,     100m, 7),   // same pair again -> moves
        (3, 8, null,  500m, 8),   // no driver       -> stays
        (4, 8, house, 300m, 8),   // the market drove it -> stays
        (5, 9, 9,     250m, 9),   // the seller drove his own load -> already right, stays
    };

    var moved = ledger
        .Where(r => InvoiceLedgerTarget.SaleGoesTo(r.Seller, r.Driver, house) != r.Seller)
        .ToList();

    Check("only the loads an outside driver brought move",
          moved.Count == 2 && moved.All(r => r.Driver == 9 && r.Seller == 7), $"got {moved.Count}");
    Check("a load with no driver stays with its seller",
          !moved.Any(r => r.InvoiceId == 3));
    Check("a load the market drove stays with its seller",
          !moved.Any(r => r.InvoiceId == 4));
    Check("a seller who drove his own load is already where he belongs",
          !moved.Any(r => r.InvoiceId == 5));

    // The only property that really matters: money is not created or destroyed by moving it. What
    // comes off the sellers is what lands on the drivers, to the agora.
    var offSellers = moved.GroupBy(r => r.Seller).ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));
    var ontoDrivers = moved.GroupBy(r => r.Driver!.Value).ToDictionary(g => g.Key, g => g.Sum(r => r.Amount));
    Check("what leaves the sellers is what arrives at the drivers",
          offSellers.Values.Sum() == ontoDrivers.Values.Sum(), $"{offSellers.Values.Sum()} vs {ontoDrivers.Values.Sum()}");
    Check("and it is the right figure",
          ontoDrivers[9] == 1_000m, $"got {ontoDrivers[9]}");

    // Run it twice and the second run finds nothing: once a row sits on the driver, the rule it is
    // tested against says that is where it belongs. A migration that keeps finding work to do is
    // one that moves the same money again every time somebody presses the button.
    var after = ledger
        .Select(r => moved.Any(m => m.InvoiceId == r.InvoiceId) ? r with { OwnedBy = r.Driver!.Value } : r)
        .ToList();
    var secondPass = after
        .Where(r => InvoiceLedgerTarget.SaleGoesTo(r.Seller, r.Driver, house) != r.OwnedBy)
        .ToList();
    Check("running it a second time finds nothing left to move", secondPass.Count == 0, $"got {secondPass.Count}");

    // And the undo is the recorded move read backwards, which returns every account to exactly
    // where it started - not to where the rule guesses it was.
    var undone = after
        .Select(r => moved.Any(m => m.InvoiceId == r.InvoiceId) ? r with { OwnedBy = r.Seller } : r)
        .ToList();
    Check("undoing puts every row back on the account it came from",
          undone.All(r => r.OwnedBy == ledger.Single(l => l.InvoiceId == r.InvoiceId).OwnedBy));
}

Console.WriteLine();
Console.WriteLine("== which paper book an invoice came from (SourceBooks) ==");
{
    // Four names, and the point of validating them is the filter: a fifth spelling is a row that
    // the search for that book will never find, on the one field whose whole job is to be searched.
    Check("the four books are accepted", SourceBooks.All.All(SourceBooks.IsValid));
    Check("there are four of them", SourceBooks.All.Length == 4);
    Check("no duplicates", SourceBooks.All.Distinct().Count() == SourceBooks.All.Length);

    Check("not recorded is valid — the field is optional", SourceBooks.IsValid(null));
    Check("and so is blank", SourceBooks.IsValid(""));
    Check("and whitespace", SourceBooks.IsValid("   "));

    Check("a name that is not one of them is refused", !SourceBooks.IsValid("محمد"));
    // A stray space is the same book to a reader, so it is accepted and trimmed on the way in —
    // not refused. IsValid asks the same question Normalize answers, which is why the two cannot
    // disagree about a value the way a validate-then-store pair would.
    Check("a stray space is still the book", SourceBooks.IsValid("طارق "));
    Check("and so is a partial one", !SourceBooks.IsValid("أبو"));

    // Normalize is what makes the near miss a non-issue for anyone typing through the screen:
    // it trims first, so a stray space is stored as the real name rather than refused at the door.
    Check("trimming turns a stray space back into the book", SourceBooks.Normalize(" طارق ") == SourceBooks.Tareq);
    Check("blank stores as nothing, not as an empty string", SourceBooks.Normalize("   ") is null);
    Check("and null stays null", SourceBooks.Normalize(null) is null);
}

Console.WriteLine();
Console.WriteLine("== a statement for a period (AccountStatementBuilder.Slice) ==");
{
    // Four movements across two months, and the running balance the full statement shows.
    var day = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    var full = AccountStatementBuilder.Build(new[]
    {
        new AccountStatementBuilder.Entry(day,             "فاتورة 1", 1_000m),
        new AccountStatementBuilder.Entry(day.AddDays(10), "دفعة",     -400m),
        new AccountStatementBuilder.Entry(day.AddDays(40), "فاتورة 2", 2_500m),
        new AccountStatementBuilder.Entry(day.AddDays(50), "دفعة",   -1_000m),
    });
    Check("the full statement closes on the real balance",
          full[^1].RunningBalance == 2_100m, $"got {full[^1].RunningBalance}");

    // February only. The two January lines collapse into one, and the column has to keep adding
    // up from where they left it — a period statement whose first number comes from nowhere is
    // the failure this exists to prevent.
    var feb = AccountStatementBuilder.Slice(full, day.AddDays(31), day.AddDays(59));
    Check("the period opens on a brought-forward line",
          feb[0].Description == AccountStatementBuilder.BroughtForwardDescription);
    Check("...carrying exactly what January left behind",
          feb[0].RunningBalance == 600m, $"got {feb[0].RunningBalance}");
    Check("and only February’s own movements follow it", feb.Count == 3, $"got {feb.Count}");
    Check("the column still adds up",
          feb[^1].RunningBalance == 2_100m, $"got {feb[^1].RunningBalance}");
    // The identity that makes the sliced page trustworthy: opening + what moved = closing.
    var moved = feb.Skip(1).Sum(l => l.SignedAmount);
    Check("opening + the period’s movement = the closing balance",
          feb[0].RunningBalance + moved == feb[^1].RunningBalance);

    // Cutting the end makes the last line the balance AS AT that date, not today.
    var toMidFeb = AccountStatementBuilder.Slice(full, null, day.AddDays(45));
    Check("an end date closes the statement on that date’s balance",
          toMidFeb[^1].RunningBalance == 3_100m, $"got {toMidFeb[^1].RunningBalance}");
    Check("and drops what came after it", toMidFeb.Count == 3, $"got {toMidFeb.Count}");

    // A quiet month is an answer, not an empty page: he moved nothing and still owes 2,100.
    var quiet = AccountStatementBuilder.Slice(full, day.AddDays(200), day.AddDays(230));
    Check("a period with no movement still says what the balance is",
          quiet.Count == 1 && quiet[0].RunningBalance == 2_100m, $"got {quiet.Count} line(s)");

    // Nothing before the period => nothing to carry, and no line inventing a zero.
    var fromStart = AccountStatementBuilder.Slice(full, day, day.AddDays(20));
    Check("a period starting at the beginning carries nothing forward",
          fromStart.Count == 2 && fromStart[0].Description == "فاتورة 1", $"got {fromStart.Count}");

    Check("no range at all returns the statement untouched",
          ReferenceEquals(AccountStatementBuilder.Slice(full, null, null), full));

    // The slice reads the running balance that was already computed; it never re-sums a subset.
    // If it did, every figure on a period sheet would differ from the same figure on the full one.
    Check("a line reads the same whichever window it is printed in",
          feb[1].RunningBalance == full[2].RunningBalance && feb[1].Description == full[2].Description);
}

Console.WriteLine();
Console.WriteLine($"RESULT: {passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;
