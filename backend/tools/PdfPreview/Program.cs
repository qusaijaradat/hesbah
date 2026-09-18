// Renders one of each printed document from made-up data, so a layout/styling change can actually
// be looked at without a database, a running API or a real invoice. Writes the PDFs to the folder
// given as the first argument (default: ./out).
//
//   dotnet run --project backend/tools/PdfPreview -- C:\some\folder
//
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Services;
using GreenMarket.Domain.Enums;
using QuestPDF.Infrastructure;

QuestPDF.Settings.License = LicenseType.Community;
PdfFontRegistration.RegisterBundledFonts();

var outDir = args.Length > 0 ? args[0] : Path.Combine(Directory.GetCurrentDirectory(), "out");
Directory.CreateDirectory(outDir);

var logo = await new CompanyLogoFromDisk().Read();
var company = new CompanyInfo(
    "سوق موسى حامد وأولاده للخضار والفواكه",
    "نابلس - شارع الحسبة",
    "0599-123456",
    "562-431-908",
    logo);

// The fixture is checked against itself below before anything renders. A preview whose own
// numbers do not add up cannot show that a document adds up, and this one had drifted: its
// WoodTotal was 180.5, left over from when سعر الخشب was charged per unit rather than as a flat
// per-line add-on, so the buyer's total, the driver's due and the market's profit were each built
// on a figure the lines underneath them contradicted.
var items = new List<InvoiceItemDto>
{
    // (id, name, العدد, الوزن, السعر, صناديق, كرتون, سعر الخشب, الإجمالي)
    // Line 1 is the case the old shape could not hold at all: weighed AND out in 12 crates.
    new(1, "بندورة", 12m, 120.5m, 3.5m, 12m, 0m, 5m, 421.75m),
    new(2, "خيار", 40m, null, 12m, 40m, 0m, 6m, 480m),
    new(3, "باذنجان", 30m, 75.25m, 2.75m, 0m, 30m, 0m, 206.94m),
};

var invoice = new InvoiceDto(
    101, "INV-2026-000042", DateTimeOffset.Now,
    7, "محل أبو عمار للخضار", "970599111222",
    9, "المزارع سامي حسن", "970599333444",
    11, "السائق خالد", "970599555666",
    InvoiceStatus.Active,
    TotalWeightKg: 195.75m, TotalValue: 1108.69m, TransportFee: 80m, WoodTotal: 11m,
    TotalBoxes: 52m, TotalCartons: 30m, BoxPriceApplied: 1.5m, BoxFeeTotal: 78m,
    DriverBoxFeeApplied: 0.5m, DriverBoxFeeTotal: 26m,
    GrandTotal: 1147.69m,
    PreviousBalance: 2450m,
    CommissionRateApplied: 0.10m, Commission: 110.87m, NetDueToFarmer: 917.82m, DriverDue: 106m,
    ReturnsTotal: 50m,
    PaidAmount: 500m, RemainingAmount: 647.69m, PaymentStatus: InvoicePaymentStatus.Partial,
    MarketProfit: 168.87m,
    HasUnpricedItems: false,
    SourceBook: null,
    Items: items,
    Returns: new List<GoodsReturnDto>());

// Every figure on the fixture, checked against the domain functions that produce it in the real
// thing — so the eight documents below are rendered from an invoice that actually reconciles,
// and a future edit to any one number fails here instead of quietly printing a wrong example.
void Same(string what, decimal actual, decimal expected)
{
    if (actual == expected) return;
    Console.Error.WriteLine($"fixture is inconsistent — {what}: has {actual}, should be {expected}");
    Environment.Exit(1);
}

Same("TotalValue", invoice.TotalValue, items.Sum(i => i.LineTotal));
Same("TotalWeightKg", invoice.TotalWeightKg, items.Sum(i => i.WeightKg ?? 0m));
Same("WoodTotal", invoice.WoodTotal, items.Sum(i => i.WoodPrice));
Same("TotalBoxes", invoice.TotalBoxes, items.Sum(i => i.BoxQuantity));
Same("TotalCartons", invoice.TotalCartons, items.Sum(i => i.CartonQuantity));
Same("BoxFeeTotal", invoice.BoxFeeTotal, invoice.TotalBoxes * invoice.BoxPriceApplied);
Same("DriverBoxFeeTotal", invoice.DriverBoxFeeTotal, invoice.TotalBoxes * invoice.DriverBoxFeeApplied);
foreach (var line in items)
    Same($"line total for {line.ItemName}", line.LineTotal,
         InvoiceCalculator.LineTotalFor(line.Quantity, line.WeightKg, line.PricePerUnit));

var fixtureCommission = CommissionCalculator.Calculate(invoice.TotalValue, invoice.CommissionRateApplied).Commission;
Same("Commission", invoice.Commission, fixtureCommission);
Same("GrandTotal", invoice.GrandTotal,
     InvoiceCharge.ForMerchant(invoice.TotalValue, invoice.WoodTotal, invoice.BoxFeeTotal, invoice.ReturnsTotal));
Same("NetDueToFarmer", invoice.NetDueToFarmer,
     InvoiceCharge.ForSeller(invoice.TotalValue, invoice.Commission, invoice.TransportFee));
Same("DriverDue", invoice.DriverDue, InvoiceCharge.ForDriver(invoice.TransportFee, invoice.DriverBoxFeeTotal));
Same("RemainingAmount", invoice.RemainingAmount, invoice.GrandTotal - invoice.PaidAmount);
Same("MarketProfit", invoice.MarketProfit,
     MarketEarnings.ForInvoice(invoice.Commission, invoice.BoxFeeTotal, invoice.DriverBoxFeeTotal,
         invoice.TransportFee, invoice.WoodTotal, hasDriver: invoice.DriverId != null)
     - MarketEarnings.CommissionCreditOnReturn(invoice.ReturnsTotal, invoice.CommissionRateApplied));

// And the identity itself, on the fixture: what the buyer pays, less what the seller and driver
// are due, is what the market keeps. The seller's side moves by the return net of its commission.
Same("buyer - seller - driver == market",
     invoice.GrandTotal
     - (invoice.NetDueToFarmer - (invoice.ReturnsTotal - MarketEarnings.CommissionCreditOnReturn(invoice.ReturnsTotal, invoice.CommissionRateApplied)))
     - invoice.DriverDue,
     invoice.MarketProfit);

var export = new ExportService();

Write("01-merchant-a4.pdf", export.GenerateInvoicePdf(invoice, company, thermalWidth: false));
Write("02-merchant-thermal.pdf", export.GenerateInvoicePdf(invoice, company, thermalWidth: true));
Write("03-farmer.pdf", export.GenerateFarmerInvoicePdf(invoice, company, previousBalance: 320m));

var four = new[] { invoice, invoice, invoice, invoice };
Write("04-bulk-merchant.pdf", export.GenerateInvoicesBulkPdf(four, company, InvoicePrintRole.Merchant, houseDriverPartnerId: null));
Write("05-bulk-farmer.pdf", export.GenerateInvoicesBulkPdf(four, company, InvoicePrintRole.Farmer, houseDriverPartnerId: null));
Write("06-bulk-driver.pdf", export.GenerateInvoicesBulkPdf(four, company, InvoicePrintRole.Driver, houseDriverPartnerId: null));


// A second, deliberately SHORTER invoice — one line against the first one's three.
//
// It exists for exactly one picture: the 4-per-page sheet below mixes the two, so the sheet shows
// whether the الإجمالي on a one-line card lands at the same height as the الإجمالي on a three-line
// one. Four cards that agree is the whole point of pinning them to the bottom of the quarter; a
// preview built from four copies of the same invoice could never show it either way.
var shortItems = new List<InvoiceItemDto>
{
    new(4, "ملفوف", 10m, null, 4m, 10m, 0m, 0m, 40m),
};
var shortCommission = CommissionCalculator.Calculate(40m, 0.10m).Commission;
var shortMarketProfit = MarketEarnings.ForInvoice(
    shortCommission, boxFeeTotal: 15m, driverBoxFeeTotal: 5m, transportFee: 20m, woodTotal: 0m, hasDriver: true);

var shortInvoice = new InvoiceDto(
    102, "INV-2026-000043", DateTimeOffset.Now,
    7, "محل أبو عمار للخضار", "970599111222",
    9, "المزارع سامي حسن", "970599333444",
    11, "السائق خالد", "970599555666",
    InvoiceStatus.Active,
    TotalWeightKg: 0m, TotalValue: 40m, TransportFee: 20m, WoodTotal: 0m,
    TotalBoxes: 10m, TotalCartons: 0m, BoxPriceApplied: 1.5m, BoxFeeTotal: 15m,
    DriverBoxFeeApplied: 0.5m, DriverBoxFeeTotal: 5m,
    GrandTotal: 55m,
    PreviousBalance: 0m,
    CommissionRateApplied: 0.10m, Commission: shortCommission,
    NetDueToFarmer: 16m, DriverDue: 25m,
    ReturnsTotal: 0m,
    PaidAmount: 0m, RemainingAmount: 55m, PaymentStatus: InvoicePaymentStatus.Unpaid,
    MarketProfit: shortMarketProfit,
    HasUnpricedItems: false,
    SourceBook: null,
    Items: shortItems,
    Returns: new List<GoodsReturnDto>());

// Checked the same way as the invoice above — a short fixture is still a fixture, and one that
// does not reconcile would print a picture of a bug rather than a picture of a layout.
Same("short TotalValue", shortInvoice.TotalValue, shortItems.Sum(i => i.LineTotal));
Same("short BoxFeeTotal", shortInvoice.BoxFeeTotal, shortInvoice.TotalBoxes * shortInvoice.BoxPriceApplied);
Same("short DriverBoxFeeTotal", shortInvoice.DriverBoxFeeTotal, shortInvoice.TotalBoxes * shortInvoice.DriverBoxFeeApplied);
Same("short GrandTotal", shortInvoice.GrandTotal,
     InvoiceCharge.ForMerchant(shortInvoice.TotalValue, shortInvoice.WoodTotal, shortInvoice.BoxFeeTotal, shortInvoice.ReturnsTotal));
Same("short NetDueToFarmer", shortInvoice.NetDueToFarmer,
     InvoiceCharge.ForSeller(shortInvoice.TotalValue, shortInvoice.Commission, shortInvoice.TransportFee));
Same("short DriverDue", shortInvoice.DriverDue,
     InvoiceCharge.ForDriver(shortInvoice.TransportFee, shortInvoice.DriverBoxFeeTotal));
Same("buyer - seller - driver == market (short)",
     shortInvoice.GrandTotal - shortInvoice.NetDueToFarmer - shortInvoice.DriverDue, shortInvoice.MarketProfit);


// And a deliberately LONG one — six lines against the short one's single line.
//
// The mixed sheet below is the only check that a quarter-page card still FITS now that its table
// and its totals have been enlarged. A card that overflows its quadrant is a layout failure that
// no unit test would ever notice and that only shows up on paper.
var longItems = new List<InvoiceItemDto>
{
    new(5, "بندورة", 10m, null, 4m, 10m, 0m, 0m, 40m),
    new(6, "خيار", 10m, null, 4m, 10m, 0m, 0m, 40m),
    new(7, "باذنجان", 10m, null, 4m, 10m, 0m, 0m, 40m),
    new(8, "كوسا", 10m, null, 4m, 10m, 0m, 0m, 40m),
    new(9, "فلفل", 10m, null, 4m, 10m, 0m, 0m, 40m),
    new(10, "ملفوف", 10m, null, 4m, 10m, 0m, 0m, 40m),
};
var longCommission = CommissionCalculator.Calculate(240m, 0.10m).Commission;
var longMarketProfit = MarketEarnings.ForInvoice(
    longCommission, boxFeeTotal: 90m, driverBoxFeeTotal: 30m, transportFee: 20m, woodTotal: 0m, hasDriver: true);

var longInvoice = new InvoiceDto(
    103, "INV-2026-000044", DateTimeOffset.Now,
    7, "محل أبو عمار للخضار", "970599111222",
    9, "المزارع سامي حسن", "970599333444",
    11, "السائق خالد", "970599555666",
    InvoiceStatus.Active,
    TotalWeightKg: 0m, TotalValue: 240m, TransportFee: 20m, WoodTotal: 0m,
    TotalBoxes: 60m, TotalCartons: 0m, BoxPriceApplied: 1.5m, BoxFeeTotal: 90m,
    DriverBoxFeeApplied: 0.5m, DriverBoxFeeTotal: 30m,
    GrandTotal: 330m,
    PreviousBalance: 1250m,
    CommissionRateApplied: 0.10m, Commission: longCommission,
    NetDueToFarmer: 196m, DriverDue: 50m,
    ReturnsTotal: 0m,
    PaidAmount: 0m, RemainingAmount: 330m, PaymentStatus: InvoicePaymentStatus.Unpaid,
    MarketProfit: longMarketProfit,
    HasUnpricedItems: false,
    SourceBook: null,
    Items: longItems,
    Returns: new List<GoodsReturnDto>());

Same("long TotalValue", longInvoice.TotalValue, longItems.Sum(i => i.LineTotal));
Same("long BoxFeeTotal", longInvoice.BoxFeeTotal, longInvoice.TotalBoxes * longInvoice.BoxPriceApplied);
Same("long GrandTotal", longInvoice.GrandTotal,
     InvoiceCharge.ForMerchant(longInvoice.TotalValue, longInvoice.WoodTotal, longInvoice.BoxFeeTotal, longInvoice.ReturnsTotal));
Same("long NetDueToFarmer", longInvoice.NetDueToFarmer,
     InvoiceCharge.ForSeller(longInvoice.TotalValue, longInvoice.Commission, longInvoice.TransportFee));
Same("long DriverDue", longInvoice.DriverDue,
     InvoiceCharge.ForDriver(longInvoice.TransportFee, longInvoice.DriverBoxFeeTotal));
Same("buyer - seller - driver == market (long)",
     longInvoice.GrandTotal - longInvoice.NetDueToFarmer - longInvoice.DriverDue, longInvoice.MarketProfit);

// An invoice with more lines than one card holds. It must come out as SEVERAL cards that continue
// each other — header repeated, "صفحة ١ من ٣" on each, and the totals on the last one only — not
// as one squeezed card and not as a layout crash.
var floodItems = Enumerable.Range(1, 20)
    .Select(i => new InvoiceItemDto(200 + i, $"صنف رقم {i}", 10m, null, 4m, 10m, 0m, 0m, 40m))
    .ToList();
// The seller who drove his own load — one person in both slots. His driver card has to show both
// sides itemised and one combined total, not just the haulage; the other half of what he is owed
// used to be on a different section's sheet entirely.
var ownLoad = invoice with { DriverId = invoice.FarmerId, DriverName = invoice.FarmerName };
Same("seller-driver total is the two sides added",
     InvoiceCharge.ForSellerDriver(ownLoad.TotalValue, ownLoad.Commission, ownLoad.TransportFee, ownLoad.DriverBoxFeeTotal),
     ownLoad.NetDueToFarmer + ownLoad.DriverDue);
Write("13-bulk-driver-who-is-the-seller.pdf",
    export.GenerateInvoicesBulkPdf(new[] { ownLoad, ownLoad }, company, InvoicePrintRole.Driver, houseDriverPartnerId: null));

Write("12-bulk-spilled-invoice.pdf",
    export.GenerateInvoicesBulkPdf(new[] { longInvoice with { Items = floodItems } }, company, InvoicePrintRole.Merchant, houseDriverPartnerId: null));

Write("11-bulk-mixed-lengths.pdf",
    export.GenerateInvoicesBulkPdf(
        new[] { invoice, shortInvoice, longInvoice, shortInvoice }, company, InvoicePrintRole.Merchant, houseDriverPartnerId: null));

// The market's own vehicle brought it: the produce money never left the sellers, so this stays
// the haulage note it always was.
Write("07-driver-manifest.pdf",
    export.GenerateDriverManifestPdf(new[]
    {
        new DriverManifest("السائق خالد", new[] { invoice, invoice }, 140m, SellerMoneyGoesToDriver: false),
    }, company));

// An outside driver: one load, three sellers, and he hands each of them their own share out of
// the single amount he collects. Two loads for the same seller so the grouping has something to
// group, and one with no seller named at all — the money for it went to him like any other.
var otherSeller = invoice with { FarmerId = 21, FarmerName = "المزارع أبو زياد", MerchantName = "محل النجاح" };
var noSeller = shortInvoice with { FarmerId = null, FarmerName = null, MerchantName = "بسطة السوق" };
var driverLoad = new[] { invoice, shortInvoice, otherSeller, noSeller };
Same("the sheet's own addition is what the market pays out",
     driverLoad.Sum(i => i.NetDueToFarmer) + driverLoad.Sum(i => i.TransportFee) + driverLoad.Sum(i => i.DriverBoxFeeTotal),
     driverLoad.Sum(i => i.TotalValue - i.Commission + i.DriverBoxFeeTotal));
// Two drivers in one print run: a sheet each, in one file.
Write("16-driver-invoice.pdf",
    export.GenerateDriverManifestPdf(new[]
    {
        new DriverManifest("السائق خالد", driverLoad, 140m, SellerMoneyGoesToDriver: true),
        new DriverManifest("السائق محمود", new[] { otherSeller }, 0m, SellerMoneyGoesToDriver: true),
    }, company));

var statementLines = new List<StatementLineDto>
{
    new(DateTimeOffset.Now.AddDays(-9), "فاتورة", 1200m, 1200m, 31, "INV-2026-000031", 1200m, 120m, null, null),
    new(DateTimeOffset.Now.AddDays(-4), "دفعة", -700m, 500m, null, null, null, null, "شيك", "شيك رقم 88231"),
    new(DateTimeOffset.Now, "فاتورة", 1329.19m, 1829.19m, 101, "INV-2026-000042", 1108.69m, 110.87m, null, null),
};
// The سند قبض a buyer asks for: money IN, so it reads "استلمنا من".
Write("20-payment-receipt-buyer.pdf",
    export.GeneratePaymentReceiptPdf(
        new PaymentDto(91, 7, "محل أبو عمار للخضار", PaymentDirection.FromMerchant, 1_500m,
            DateTimeOffset.Now, "نقدًا", "دفعة على حساب الأسبوع", 101, "INV-2026-000042",
            null, null, null, null, null),
        company));

// Money OUT to a seller, paid by a cheque still in collection — the slip says so under the amount,
// because a voucher for money that has not moved is proof of something that has not happened.
Write("21-payment-receipt-seller-check.pdf",
    export.GeneratePaymentReceiptPdf(
        new PaymentDto(92, 9, "المزارع سامي حسن", PaymentDirection.ToFarmer, 5_000m,
            DateTimeOffset.Now, "شيك", null, null, null,
            DateTimeOffset.Now.AddDays(30), "88231", CheckClearanceStatus.Pending, null, null),
        company));

// The سند قبض for one expense — two copies on the sheet, one for each side.
Write("18-expense-receipt.pdf",
    export.GenerateExpenseReceiptPdf(
        new ExpenseDto(37, DateTimeOffset.Now, "أجرة عمال تنزيل — يوم الخميس", 450m, "أجور", 4, "محمود العبد"),
        company));

// The same voucher with nobody named: the recipient and the signature are lines to write on.
Write("19-expense-receipt-unnamed.pdf",
    export.GenerateExpenseReceiptPdf(
        new ExpenseDto(38, DateTimeOffset.Now, "تصليح موتور المي", 120m, null, null, null),
        company));

// The same account narrowed to a period: it opens on what the earlier movements left behind,
// rather than on a figure with nothing above it.
Write("17-account-statement-period.pdf",
    export.GenerateAccountStatementPdf("محل أبو عمار للخضار", "كشف حساب مشتري",
        new List<StatementLineDto>
        {
            new(DateTimeOffset.Now.AddDays(-5), AccountStatementBuilder.BroughtForwardDescription, 500m, 500m, null, null, null, null, null, null),
            statementLines[2],
        },
        1_829.19m, company, DateTimeOffset.Now.AddDays(-5), DateTimeOffset.Now));

// The seller/driver sheet with its detail underneath: what he sold item by item, and the sellers
// he carried for with the haulage and the crate money on each.
var statementDetail = new StatementDetailDto(
    Array.Empty<StatementDetailLine>(),
    new List<StatementDetailLine>
    {
        new(DateTimeOffset.Now.AddDays(-9), "INV-2026-000031", "بندورة", 12m, 120.5m, 3.5m, 421.75m),
        new(DateTimeOffset.Now.AddDays(-9), "INV-2026-000031", "خيار", 40m, null, 12m, 480m),
        new(DateTimeOffset.Now, "INV-2026-000042", "باذنجان", 30m, 75.25m, 0m, 0m),
    },
    new List<StatementDriverRow>
    {
        new("المزارع أبو زياد", 52m, 240m, 26m),
        new("المزارع سامي حسن", 10m, 80m, 5m),
    });
Write("22-account-statement-detailed.pdf",
    export.GenerateAccountStatementPdf("المزارع سامي حسن", "كشف حساب بائع", statementLines, 1_829.19m, company,
        null, null, statementDetail));

Write("08-account-statement.pdf",
    export.GenerateAccountStatementPdf("محل أبو عمار للخضار", "كشف حساب مشتري", statementLines, 1829.19m, company));

// كشف بائع — one seller, a date range, several invoices. The document people actually argue
// over, because it is the one that says what the market owes someone.
//
// Two invoices on purpose: أجرة النقل is charged per INVOICE, so a statement's transport total
// is a sum across invoices that no single item row can account for. That is exactly why the
// deduction has to be stated on its own line at the end rather than folded into any item.
var farmerStatementLines = new List<FarmerStatementLineDto>
{
    // (date, item, العدد, الوزن, السعر, سعر الخشب, إجمالي السطر, نسبة العمولة)
    new(DateTimeOffset.Now.AddDays(-6), "بندورة", 12m, 120.5m, 3.5m, 5m, 421.75m, 0.10m),
    new(DateTimeOffset.Now.AddDays(-6), "خيار", 40m, null, 12m, 6m, 480m, 0.10m),
    new(DateTimeOffset.Now.AddDays(-2), "بندورة", 20m, 210m, 3.25m, 0m, 682.5m, 0.10m),
};
// No driver side: he sold, somebody else drove.
var farmerStatement = new FarmerStatementDto(
    9, "المزارع سامي حسن", TransportTotal: 145m,
    new FarmerStatementDriverSide(0m, 0m), farmerStatementLines);

// The settlement the PDF prints, recomputed here the same way it builds it — per LINE, because
// a statement can span invoices written at different commission rates — and then run through
// InvoiceCharge.ForSeller. If these two ever disagree, the printed كشف بائع is wrong about what
// a person is owed, which is the one thing this document exists to say.
var statementSales = farmerStatementLines.Sum(l => l.LineTotal);
var statementCommission = farmerStatementLines.Sum(l =>
    CommissionCalculator.Calculate(l.LineTotal, l.CommissionRateApplied).Commission);
Same("seller statement net due",
     InvoiceCharge.ForSeller(statementSales, statementCommission, farmerStatement.TransportTotal),
     statementSales - statementCommission - farmerStatement.TransportTotal);

// The same period for a man who drove his own loads: the أجرة النقل deducted from his seller side
// comes back on his driver side, and أجرة الصناديق is added. The statement has to show both, or a
// reader who sees the deduction and not the repayment will believe the market charged him to
// carry his own goods.
var ownLoadStatement = farmerStatement with { DriverSide = new FarmerStatementDriverSide(145m, 38m) };
Same("a seller-driver statement nets out to seller + driver",
     InvoiceCharge.ForSeller(statementSales, statementCommission, ownLoadStatement.TransportTotal)
     + InvoiceCharge.ForDriver(ownLoadStatement.DriverSide.TransportTotal, ownLoadStatement.DriverSide.BoxFeeTotal),
     statementSales - statementCommission + ownLoadStatement.DriverSide.BoxFeeTotal);
Write("14-seller-driver-statement.pdf",
    export.GenerateFarmerStatementPdf(ownLoadStatement, DateTimeOffset.Now.AddDays(-7), DateTimeOffset.Now,
        company, previousBalance: 260m, buyerOwes: 0m));

// The man who sells AND buys: what he owes on the other side comes off the foot of this sheet,
// on its own line, so the figure he is handed is the figure he can check.
Write("09-farmer-statement.pdf",
    export.GenerateFarmerStatementPdf(farmerStatement, DateTimeOffset.Now.AddDays(-7), DateTimeOffset.Now,
        company, previousBalance: 260m, buyerOwes: 1_450m));

// The same statement with no transport and no opening balance — the case that used to print no
// أجرة النقل line at all, leaving a reader unable to tell a zero from an omission.
Write("10-farmer-statement-no-transport.pdf",
    export.GenerateFarmerStatementPdf(
        new FarmerStatementDto(
            9, "المزارع سامي حسن", TransportTotal: 0m,
            new FarmerStatementDriverSide(0m, 0m), farmerStatementLines),
        DateTimeOffset.Now.AddDays(-7), DateTimeOffset.Now, company, previousBalance: 0m, buyerOwes: 0m));


// المخالات — the market's total per kind, who is holding what, and the log behind both.
//
// The fixture is the case the whole feature exists for: fifty sacks out and fifty back, and NOT
// square. Thirty red are still with the buyer and thirty yellow are now the market's to give back.
// A single count of sacks says they are even, which is the answer this report has to disagree with.
var sackMovements = new List<SackMovementDto>
{
    new(1, 7, "محل أبو عمار للخضار", 1, "أحمر", "Out", DateTimeOffset.Now.AddDays(-5), 30m, null),
    new(2, 7, "محل أبو عمار للخضار", 2, "أصفر", "Out", DateTimeOffset.Now.AddDays(-5), 20m, null),
    new(3, 7, "محل أبو عمار للخضار", 2, "أصفر", "In", DateTimeOffset.Now.AddDays(-1), 50m, "رجّع الخمسين كلهم أصفر"),
    // A row from before kinds existed: still sacks somebody is holding, counted under "بدون نوع".
    new(4, 9, "المزارع سامي حسن", null, "بدون نوع", "Out", DateTimeOffset.Now.AddDays(-9), 12m, null),
};

var sackTotals = sackMovements
    .GroupBy(m => (m.SackKindId, m.SackKindName))
    .Select(g => {
        var o = g.Where(x => x.Direction == "Out").Sum(x => x.Quantity);
        var i = g.Where(x => x.Direction == "In").Sum(x => x.Quantity);
        // 200 of each owned, so the shelf figure on the page is something a reader can check:
        // 200 owned less 30 still out is 170 on the shelf.
        var have = g.Key.SackKindId is null ? 0m : 200m;
        return new SackKindTotalDto(g.Key.SackKindId, g.Key.SackKindName, o, i, o - i, have, have - (o - i));
    })
    .ToList();

var sackByPartner = sackMovements
    .GroupBy(m => (m.PartnerId, m.PartnerName, m.SackKindId, m.SackKindName))
    .Select(g => new SackPartnerKindDto(
        g.Key.PartnerId, g.Key.PartnerName, null, g.Key.SackKindId, g.Key.SackKindName,
        g.Where(x => x.Direction == "Out").Sum(x => x.Quantity),
        g.Where(x => x.Direction == "In").Sum(x => x.Quantity),
        g.Where(x => x.Direction == "Out").Sum(x => x.Quantity) - g.Where(x => x.Direction == "In").Sum(x => x.Quantity)))
    .OrderByDescending(p => p.Outstanding)
    .ToList();

// Derived from the movements above rather than typed out beside them, so the three tables on the
// page cannot disagree with each other the way three hand-written lists eventually would.
Same("red is still out", sackTotals.Single(t => t.SackKindName == "أحمر").Outstanding, 30m);
Same("yellow came back over", sackTotals.Single(t => t.SackKindName == "أصفر").Outstanding, -30m);
Same("fifty out and fifty back nets to zero across kinds", sackTotals.Sum(t => t.Outstanding), 12m);

Write("15-sacks-overview.pdf", export.GenerateSacksOverviewPdf(
    new SacksOverviewDto(DateTimeOffset.Now.AddDays(-30), DateTimeOffset.Now, sackTotals, sackByPartner, sackMovements),
    company));

Console.WriteLine($"\n{outDir}");

void Write(string name, byte[] bytes)
{
    var path = Path.Combine(outDir, name);
    File.WriteAllBytes(path, bytes);
    Console.WriteLine($"{name,-28} {bytes.Length,8:N0} B");
}

// The bundled default logo, read the same way CompanyLogoService reads it (embedded resource),
// without needing a database for the "has the market uploaded their own?" lookup.
sealed class CompanyLogoFromDisk
{
    public Task<byte[]?> Read()
    {
        var assembly = typeof(ExportService).Assembly;
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("default-logo.png", StringComparison.OrdinalIgnoreCase));
        if (name is null) return Task.FromResult<byte[]?>(null);
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return Task.FromResult<byte[]?>(memory.ToArray());
    }
}
