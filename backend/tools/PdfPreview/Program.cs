// Renders one of each printed document from made-up data, so a layout/styling change can actually
// be looked at without a database, a running API or a real invoice. Writes the PDFs to the folder
// given as the first argument (default: ./out).
//
//   dotnet run --project backend/tools/PdfPreview -- C:\some\folder
//
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
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

var items = new List<InvoiceItemDto>
{
    new(1, "بندورة", 120.5m, UnitOfMeasure.Kg, 3.5m, 1.0m, 421.75m),
    new(2, "خيار", 40m, UnitOfMeasure.Box, 12m, 1.5m, 480m),
    new(3, "باذنجان", 75.25m, UnitOfMeasure.Kg, 2.75m, 0m, 206.94m),
};

var invoice = new InvoiceDto(
    101, "INV-2026-000042", DateTimeOffset.Now,
    7, "محل أبو عمار للخضار", "970599111222",
    9, "المزارع سامي حسن", "970599333444",
    11, "السائق خالد", "970599555666",
    InvoiceStatus.Active,
    TotalWeightKg: 195.75m, TotalValue: 1108.69m, TransportFee: 80m, WoodTotal: 180.5m,
    TotalBoxes: 40m, BoxPriceApplied: 1.5m, BoxFeeTotal: 60m,
    DriverBoxFeeApplied: 0.5m, DriverBoxFeeTotal: 20m,
    GrandTotal: 1329.19m,
    PreviousBalance: 2450m,
    CommissionRateApplied: 0.10m, Commission: 110.87m, NetDueToFarmer: 997.82m,
    Discount: 50m, ReturnsTotal: 50m,
    PaidAmount: 500m, RemainingAmount: 829.19m, PaymentStatus: InvoicePaymentStatus.Partial,
    HasUnpricedItems: false,
    Items: items,
    Returns: new List<GoodsReturnDto>());

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
    export.GenerateAccountStatementPdf("محل أبو عمار للخضار", "كشف حساب مشتري", statementLines, 0m, 1829.19m, company));

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
