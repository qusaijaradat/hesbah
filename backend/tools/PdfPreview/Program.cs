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
Write("04-bulk-merchant.pdf", export.GenerateInvoicesBulkPdf(four, company, InvoicePrintRole.Merchant));
Write("05-bulk-farmer.pdf", export.GenerateInvoicesBulkPdf(four, company, InvoicePrintRole.Farmer));
Write("06-bulk-driver.pdf", export.GenerateInvoicesBulkPdf(four, company, InvoicePrintRole.Driver));

Write("07-driver-manifest.pdf", export.GenerateDriverManifestPdf("السائق خالد", new[] { invoice, invoice }, company, previousBalance: 140m));

var statementLines = new List<StatementLineDto>
{
    new(DateTimeOffset.Now.AddDays(-9), "فاتورة", 1200m, 1200m, 31, "INV-2026-000031", 1200m, 120m, null, null),
    new(DateTimeOffset.Now.AddDays(-4), "دفعة", -700m, 500m, null, null, null, null, "شيك", "شيك رقم 88231"),
    new(DateTimeOffset.Now, "فاتورة", 1329.19m, 1829.19m, 101, "INV-2026-000042", 1108.69m, 110.87m, null, null),
};
Write("08-account-statement.pdf",
    export.GenerateAccountStatementPdf("محل أبو عمار للخضار", "كشف حساب مشتري", statementLines, 1829.19m, company));

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
