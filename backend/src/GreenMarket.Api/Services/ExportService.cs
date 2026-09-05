using ClosedXML.Excel;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace GreenMarket.Api.Services;

/// <summary>
/// The company-identity block shown on every printed invoice/statement header — all four values
/// come from Settings (market.name, market.address, market.phone, market.registration_number) so
/// the market can fill them in themselves without a code change. Everything but Name is optional
/// and simply omitted from the header when blank.
/// </summary>
public record CompanyInfo(string Name, string? Address, string? Phone, string? RegistrationNumber, byte[]? LogoContent = null);

/// <summary>
/// Requirement doc §7/§8: every filtered report/list must be exportable to PDF or Excel.
/// Requirement doc §9: invoices must be printable (80mm thermal or A4) and sendable via
/// WhatsApp as a PDF — GenerateInvoicePdf below is that PDF.
/// </summary>
public interface IExportService
{
    byte[] InvoicesToExcel(IReadOnlyList<InvoiceListItemDto> invoices);
    byte[] FarmerReportToExcel(IReadOnlyList<FarmerReportRow> rows);
    byte[] MerchantReportToExcel(IReadOnlyList<MerchantReportRow> rows);
    byte[] DriverReportToExcel(IReadOnlyList<DriverReportRow> rows);
    byte[] MarketReportToExcel(IReadOnlyList<MarketReportRow> rows);
    byte[] AgingReportToExcel(IReadOnlyList<AgingReportRow> rows);

    byte[] GenerateInvoicePdf(InvoiceDto invoice, CompanyInfo company, bool thermalWidth);

    /// <summary>"نسخة البائع" print button (only shown when the invoice has a farmer attached) —
    /// see GenerateFarmerInvoicePdf's own doc comment.</summary>
    byte[] GenerateFarmerInvoicePdf(InvoiceDto invoice, CompanyInfo company, decimal previousBalance);

    byte[] GenerateInvoicesBulkPdf(IReadOnlyList<InvoiceDto> invoices, CompanyInfo company);

    /// <summary>Bulk-print page's merchant-section print button — see GenerateMergedInvoicesPdf's
    /// own doc comment.</summary>
    byte[] GenerateMergedInvoicesPdf(IReadOnlyList<MergedInvoiceGroupDto> groups, CompanyInfo company);
    byte[] GenerateDriverManifestPdf(string driverName, IReadOnlyList<InvoiceDto> invoices, CompanyInfo company, decimal previousBalance);
    byte[] GenerateBuyerStatementPdf(IReadOnlyList<MerchantItemBreakdownRow> rows, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company);
    byte[] GenerateFarmerItemsStatementPdf(IReadOnlyList<FarmerItemBreakdownRow> rows, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company);
    byte[] GenerateDriverItemsStatementPdf(IReadOnlyList<DriverItemBreakdownRow> rows, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company);
    byte[] GenerateFarmerStatementPdf(FarmerStatementDto statement, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company, decimal previousBalance);
    byte[] SimpleReportToPdf(string title, string[] headers, IEnumerable<string[]> rows);
    byte[] DailyClosingToPdf(DailyClosingDto closing, string marketName);

    /// <summary>"قيمة الديون" print button — see GenerateDebtsOverviewPdf's own doc comment.</summary>
    byte[] GenerateDebtsOverviewPdf(DebtsOverviewDto data, CompanyInfo company);

    /// <summary>"كشف حساب" print button on a partner's own farmer/driver/merchant account page —
    /// see GenerateAccountStatementPdf's own doc comment.</summary>
    byte[] GenerateAccountStatementPdf(string partnerName, string title, IReadOnlyList<StatementLineDto> lines, decimal openingBalance, decimal remaining, CompanyInfo company);

    /// <summary>"قيمة الديون" drill-down print button — see GenerateInvoiceDetailPdf's own doc comment.</summary>
    byte[] GenerateInvoiceDetailPdf(string partnerName, string title, IReadOnlyList<PartnerInvoiceItemLineDto> lines, CompanyInfo company);

    /// <summary>"الشيكات" print button — see GenerateChecksPdf's own doc comment.</summary>
    byte[] GenerateChecksPdf(IReadOnlyList<PaymentDto> checks, CompanyInfo company, string? periodLabel);

    /// <summary>"الدفعات" tab print button — see GeneratePaymentsListPdf's own doc comment.</summary>
    byte[] GeneratePaymentsListPdf(IReadOnlyList<PaymentDto> payments, CompanyInfo company, DateTimeOffset? dateFrom, DateTimeOffset? dateTo);

    /// <summary>"مصاريف الحسبة" tab print button — see GenerateExpensesListPdf's own doc comment.</summary>
    byte[] GenerateExpensesListPdf(IReadOnlyList<ExpenseDto> expenses, CompanyInfo company, DateTimeOffset? dateFrom, DateTimeOffset? dateTo);

    /// <summary>"بضاعة الباعة" print button — see GenerateFarmerGoodsStockPdf's own doc comment.</summary>
    byte[] GenerateFarmerGoodsStockPdf(string farmerName, IReadOnlyList<GoodsStockRow> stock, CompanyInfo company);
}

public class ExportService : IExportService
{
    // "Tahoma" is on every Windows install and — unlike QuestPDF's own default font — actually
    // has Arabic glyphs, so item/partner names typed in Arabic render as real text instead of
    // empty boxes. Set once here and reused by every PDF-producing method below.
    private const string PdfFontFamily = "Tahoma";

    public byte[] InvoicesToExcel(IReadOnlyList<InvoiceListItemDto> invoices)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Invoices");
        var headers = new[] { "Invoice #", "Date", "Buyer", "Seller", "Driver", "Items", "Status", "Weight (kg)", "Boxes", "Total (₪)", "Transport Fee (₪)", "Grand Total (₪)" };
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var inv in invoices)
        {
            sheet.Cell(row, 1).Value = inv.InvoiceNumber;
            sheet.Cell(row, 2).Value = inv.Date.ToLocalTime().DateTime;
            sheet.Cell(row, 3).Value = inv.MerchantName;
            sheet.Cell(row, 4).Value = inv.FarmerName;
            sheet.Cell(row, 5).Value = inv.DriverName;
            sheet.Cell(row, 6).Value = inv.ItemsSummary;
            sheet.Cell(row, 7).Value = inv.Status.ToString();
            sheet.Cell(row, 8).Value = (double)inv.TotalWeightKg;
            sheet.Cell(row, 9).Value = (double)inv.TotalBoxes;
            sheet.Cell(row, 10).Value = (double)inv.TotalValue;
            sheet.Cell(row, 11).Value = (double)inv.TransportFee;
            sheet.Cell(row, 12).Value = (double)inv.GrandTotal;
            row++;
        }
        sheet.Columns().AdjustToContents();
        return ToBytes(workbook);
    }

    public byte[] FarmerReportToExcel(IReadOnlyList<FarmerReportRow> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Farmer Report");
        var headers = new[] { "Farmer", "Invoices", "Total Weight (kg)", "Total Boxes", "Total Sales (₪)", "Commission (₪)", "Net Due (₪)", "Paid (₪)", "Opening Balance (₪)", "Remaining (₪)", "Last Invoice" };
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var r in rows)
        {
            sheet.Cell(row, 1).Value = r.FarmerName;
            sheet.Cell(row, 2).Value = r.InvoiceCount;
            sheet.Cell(row, 3).Value = (double)r.TotalWeightKg;
            sheet.Cell(row, 4).Value = (double)r.TotalBoxes;
            sheet.Cell(row, 5).Value = (double)r.TotalSalesValue;
            sheet.Cell(row, 6).Value = (double)r.TotalCommission;
            sheet.Cell(row, 7).Value = (double)r.NetDue;
            sheet.Cell(row, 8).Value = (double)r.TotalPaid;
            sheet.Cell(row, 9).Value = (double)r.OpeningBalance;
            sheet.Cell(row, 10).Value = (double)r.Remaining;
            sheet.Cell(row, 11).Value = r.LastInvoiceDate?.ToLocalTime().DateTime.ToString("yyyy-MM-dd") ?? "-";
            row++;
        }
        sheet.Columns().AdjustToContents();
        return ToBytes(workbook);
    }

    public byte[] MerchantReportToExcel(IReadOnlyList<MerchantReportRow> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Merchant Report");
        var headers = new[] { "Buyer", "Invoices", "Total Weight (kg)", "Total Boxes", "Purchases (₪)", "Wood (₪)", "Transport Fee (₪)", "Grand Total (₪)", "Paid (₪)", "Opening Balance (₪)", "Remaining (₪)", "Last Invoice" };
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var r in rows)
        {
            sheet.Cell(row, 1).Value = r.MerchantName;
            sheet.Cell(row, 2).Value = r.InvoiceCount;
            sheet.Cell(row, 3).Value = (double)r.TotalWeightKg;
            sheet.Cell(row, 4).Value = (double)r.TotalBoxes;
            sheet.Cell(row, 5).Value = (double)r.TotalPurchases;
            sheet.Cell(row, 6).Value = (double)r.TotalWoodTotal;
            sheet.Cell(row, 7).Value = (double)r.TotalTransportFee;
            sheet.Cell(row, 8).Value = (double)r.GrandTotal;
            sheet.Cell(row, 9).Value = (double)r.TotalPaid;
            sheet.Cell(row, 10).Value = (double)r.OpeningBalance;
            sheet.Cell(row, 11).Value = (double)r.Remaining;
            sheet.Cell(row, 12).Value = r.LastInvoiceDate?.ToLocalTime().DateTime.ToString("yyyy-MM-dd") ?? "-";
            row++;
        }
        sheet.Columns().AdjustToContents();
        return ToBytes(workbook);
    }

    public byte[] DriverReportToExcel(IReadOnlyList<DriverReportRow> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Driver Report");
        var headers = new[] { "Driver", "Invoices", "Transport Fee (₪)", "Paid (₪)", "Opening Balance (₪)", "Remaining (₪)", "Last Invoice" };
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var r in rows)
        {
            sheet.Cell(row, 1).Value = r.DriverName;
            sheet.Cell(row, 2).Value = r.InvoiceCount;
            sheet.Cell(row, 3).Value = (double)r.TotalTransportFee;
            sheet.Cell(row, 4).Value = (double)r.TotalPaid;
            sheet.Cell(row, 5).Value = (double)r.OpeningBalance;
            sheet.Cell(row, 6).Value = (double)r.Remaining;
            sheet.Cell(row, 7).Value = r.LastInvoiceDate?.ToLocalTime().DateTime.ToString("yyyy-MM-dd") ?? "-";
            row++;
        }
        sheet.Columns().AdjustToContents();
        return ToBytes(workbook);
    }

    public byte[] MarketReportToExcel(IReadOnlyList<MarketReportRow> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Market Report");
        var headers = new[] { "Period", "Total Sales (₪)", "Total Commission (₪)", "Total Expenses (₪)", "Net Profit (₪)" };
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var r in rows)
        {
            sheet.Cell(row, 1).Value = r.Period;
            sheet.Cell(row, 2).Value = (double)r.TotalSalesValue;
            sheet.Cell(row, 3).Value = (double)r.TotalCommission;
            sheet.Cell(row, 4).Value = (double)r.TotalExpenses;
            sheet.Cell(row, 5).Value = (double)r.NetProfit;
            row++;
        }
        sheet.Columns().AdjustToContents();
        return ToBytes(workbook);
    }

    public byte[] AgingReportToExcel(IReadOnlyList<AgingReportRow> rows)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Aging Report");
        var headers = new[] { "Buyer", "Current (<30d)", "30-59 days", "60-89 days", "90+ days", "Total (₪)" };
        for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).Value = headers[c];
        sheet.Row(1).Style.Font.Bold = true;

        var row = 2;
        foreach (var r in rows)
        {
            sheet.Cell(row, 1).Value = r.MerchantName;
            sheet.Cell(row, 2).Value = (double)r.Current;
            sheet.Cell(row, 3).Value = (double)r.Days30To59;
            sheet.Cell(row, 4).Value = (double)r.Days60To89;
            sheet.Cell(row, 5).Value = (double)r.Days90Plus;
            sheet.Cell(row, 6).Value = (double)r.Total;
            row++;
        }
        sheet.Columns().AdjustToContents();
        return ToBytes(workbook);
    }

    /// <summary>
    /// Requirement doc §9: printable on an 80mm thermal printer OR A4. QuestPDF page size
    /// is just swapped based on `thermalWidth` — same layout code, no duplication.
    /// Deliberately shows no commission line (§5) and no invoice number — the market doesn't
    /// want its internal invoice numbering to appear on the printed page at all.
    /// </summary>
    public byte[] GenerateInvoicePdf(InvoiceDto invoice, CompanyInfo company, bool thermalWidth)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                if (thermalWidth)
                    // 80mm thermal roll: fixed width, generous fixed height (thermal printers
                    // just cut the paper after the last line, so an oversized page is fine).
                    page.Size(new PageSize(80, 297, Unit.Millimetre));
                else
                    page.Size(PageSizes.A4);

                page.Margin(thermalWidth ? 8 : 30);
                page.DefaultTextStyle(x => x.FontSize(thermalWidth ? 9 : 11).FontFamily(PdfFontFamily));

                // RTL so every line in this Column (and the item table below) reads right-aligned
                // and right-to-left, matching how an Arabic reader scans the page — the item
                // table's "الصنف" column in particular ends up as the RIGHTMOST column (read
                // first) instead of the leftmost, with the numeric columns proceeding to its left.
                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    // Letterhead order requested: logo first (on its own, centered), then name /
                    // registration number / phone stacked directly under it, each on its own line
                    // — see CompanyHeaderBlock for the logo-on-top-of-stacked-text layout.
                    CompanyHeaderBlock(col, company, thermalWidth ? 40f : 64f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(thermalWidth ? 12 : 18);
                        if (!thermalWidth && !string.IsNullOrWhiteSpace(company.Address))
                            textCol.Item().AlignCenter().Text(company.Address).FontSize(9).FontColor(Colors.Grey.Darken1);
                        if (!thermalWidth && !string.IsNullOrWhiteSpace(company.RegistrationNumber))
                            textCol.Item().AlignCenter().Text($"رقم السجل: {company.RegistrationNumber}").FontSize(9);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(thermalWidth ? 8 : 9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).Text("فاتورة مشتري").Bold().FontSize(thermalWidth ? 10 : 13);
                    col.Item().PaddingTop(2).Text($"التاريخ: {invoice.Date:yyyy-MM-dd}").FontSize(thermalWidth ? 9 : 11);
                    col.Item().Text($"المطلوب من: {invoice.MerchantName}").FontSize(thermalWidth ? 9 : 11);
                    // البائع/السائق deliberately NOT shown here — this document goes to the buyer,
                    // who isn't shown who supplied/delivered the goods (explicit request).
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    // العدد/الوزن replace the single merged "الكمية" column on the A4 print — a
                    // Box-unit line's quantity goes under العدد with الوزن left blank, and a
                    // Kg-unit line is the mirror image, derived straight from Quantity/Unit (no
                    // separate fields to fill in — whichever the item already is drives which
                    // column shows a number). The 80mm thermal receipt keeps the original single
                    // merged column since it's already tight on space with just 4 columns.
                    // Likewise, "س.الخشب" is A4-only — same reasoning, no room for a 6th column on
                    // an 80mm receipt. Its value is the flat per-line wood/crate add-on (see
                    // InvoiceCalculator — deliberately NOT folded into مجموع كلي/LineTotal below,
                    // same convention as the on-screen invoice detail page's item table).
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(4);
                        if (thermalWidth)
                        {
                            columns.RelativeColumn(2);
                        }
                        else
                        {
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(2);
                        }
                        columns.RelativeColumn(2);
                        if (!thermalWidth)
                        {
                            columns.RelativeColumn(2);
                        }
                        columns.RelativeColumn(2);
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        if (thermalWidth)
                        {
                            header.Cell().Element(HeaderCell).AlignRight().Text("الكمية");
                        }
                        else
                        {
                            header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                            header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                        }
                        header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                        if (!thermalWidth)
                        {
                            header.Cell().Element(HeaderCell).AlignRight().Text("س.الخشب");
                        }
                        header.Cell().Element(HeaderCell).AlignRight().Text("مجموع كلي");
                    });

                    for (var i = 0; i < invoice.Items.Count; i++)
                    {
                        var item = invoice.Items[i];
                        var shaded = i % 2 == 1;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.ItemName);
                        if (thermalWidth)
                        {
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{item.Quantity:0.###} {ArabicUnitLabel(item.Unit)}");
                        }
                        else
                        {
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Box ? item.Quantity.ToString("0.###") : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Kg ? $"{item.Quantity:0.###} كغم" : "—");
                        }
                        // PricePerUnit == 0 means "not priced yet, will be priced later" (see
                        // InvoiceNewPage/InvoiceEditPage's now-optional price field) — flagged
                        // instead of printing a misleading "₪0.00" that reads as a free item.
                        var unpriced = item.PricePerUnit == 0;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.PricePerUnit.ToString("0.##"));
                        if (!thermalWidth)
                        {
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.WoodPrice > 0 ? item.WoodPrice.ToString("0.##") : "—");
                        }
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.LineTotal.ToString("0.##"));
                    }
                });

                // Not everything on the invoice is sold by weight — a box-unit line has its own
                // total instead of being folded into (or silently dropped from) the weight figure.
                var totalBoxes = invoice.Items.Where(i => i.Unit == UnitOfMeasure.Box).Sum(i => i.Quantity);

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    if (invoice.TotalWeightKg > 0)
                        col.Item().AlignRight().Text($"إجمالي الوزن: {invoice.TotalWeightKg:0.###} كغم");
                    if (totalBoxes > 0)
                        col.Item().AlignRight().Text($"إجمالي الصناديق: {totalBoxes:0.###}");
                    if (invoice.WoodTotal > 0)
                        col.Item().AlignRight().Text($"إجمالي الخشب: ₪ {invoice.WoodTotal:0.##}").FontSize(thermalWidth ? 8 : 10);
                    if (invoice.BoxFeeTotal > 0)
                        col.Item().AlignRight().Text($"رسم الصناديق: ₪ {invoice.BoxFeeTotal:0.##}").FontSize(thermalWidth ? 8 : 10);
                    if (invoice.TransportFee > 0)
                        col.Item().AlignRight().Text($"أجرة النقل: ₪ {invoice.TransportFee:0.##}").FontSize(thermalWidth ? 8 : 10);
                    col.Item().PaddingTop(4).AlignRight().Text($"الإجمالي: ₪ {invoice.GrandTotal:0.##}").Bold().FontSize(13);
                    // What this merchant still owed BEFORE this invoice (computed in
                    // InvoiceService — every OTHER Active invoice's total minus every payment
                    // they've made, all-time), added on top so the printed total is what's
                    // actually due right now, not just this invoice's own amount.
                    if (invoice.PreviousBalance > 0)
                    {
                        col.Item().AlignRight().Text($"الرصيد السابق: ₪ {invoice.PreviousBalance:0.##}").FontSize(thermalWidth ? 9 : 11);
                        col.Item().PaddingTop(2).AlignRight()
                            .Text($"الإجمالي المستحق: ₪ {(invoice.GrandTotal + invoice.PreviousBalance):0.##}").Bold().FontSize(thermalWidth ? 11 : 14);
                    }
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// "نسخة البائع" — the SAME invoice as GenerateInvoicePdf above, but from the farmer's own
    /// side: shows this invoice's own commission math and nets it out, instead of staying
    /// commission-free the way the merchant's copy must (requirement doc §5 — commission never
    /// appears on the merchant-facing invoice). Deliberately a SEPARATE method rather than a flag
    /// on GenerateInvoicePdf, so the merchant-facing PDF can never accidentally gain a code path
    /// that leaks commission onto it. Only meaningful when invoice.FarmerId is set — the caller
    /// (InvoicesController.FarmerPdf) rejects the request before ever calling this otherwise.
    /// previousBalance here is the farmer's OWN account balance right now (same كشف حساب
    /// Remaining their account page shows), never the merchant-side PreviousBalance on InvoiceDto.
    /// </summary>
    public byte[] GenerateFarmerInvoicePdf(InvoiceDto invoice, CompanyInfo company, decimal previousBalance)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(11).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 64f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(18);
                        if (!string.IsNullOrWhiteSpace(company.Address))
                            textCol.Item().AlignCenter().Text(company.Address).FontSize(9).FontColor(Colors.Grey.Darken1);
                        if (!string.IsNullOrWhiteSpace(company.RegistrationNumber))
                            textCol.Item().AlignCenter().Text($"رقم السجل: {company.RegistrationNumber}").FontSize(9);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).Text("نسخة البائع").Bold().FontSize(13);
                    col.Item().PaddingTop(2).Text($"التاريخ: {invoice.Date:yyyy-MM-dd}").FontSize(11);
                    col.Item().Text($"البائع: {invoice.FarmerName}").FontSize(11);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(4);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                        header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                        header.Cell().Element(HeaderCell).AlignRight().Text("س.الخشب");
                        header.Cell().Element(HeaderCell).AlignRight().Text("مجموع كلي");
                    });

                    for (var i = 0; i < invoice.Items.Count; i++)
                    {
                        var item = invoice.Items[i];
                        var shaded = i % 2 == 1;
                        var unpriced = item.PricePerUnit == 0;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.ItemName);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Box ? item.Quantity.ToString("0.###") : "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Kg ? $"{item.Quantity:0.###} كغم" : "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.PricePerUnit.ToString("0.##"));
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.WoodPrice > 0 ? item.WoodPrice.ToString("0.##") : "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.LineTotal.ToString("0.##"));
                    }
                });

                var totalBoxes = invoice.Items.Where(i => i.Unit == UnitOfMeasure.Box).Sum(i => i.Quantity);

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    if (invoice.TotalWeightKg > 0)
                        col.Item().AlignRight().Text($"إجمالي الوزن: {invoice.TotalWeightKg:0.###} كغم");
                    if (totalBoxes > 0)
                        col.Item().AlignRight().Text($"إجمالي الصناديق: {totalBoxes:0.###}");
                    // Informational only — wood/crate price is charged to the merchant, never
                    // deducted from what's owed to the farmer, so it's shown here (cargo detail)
                    // but deliberately kept OUT of the commission math and net-due figures below.
                    if (invoice.WoodTotal > 0)
                        col.Item().AlignRight().Text($"إجمالي الخشب (لا يدخل بحساب العمولة): ₪ {invoice.WoodTotal:0.##}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    // Same informational-only treatment as WoodTotal above — رسم الصناديق is
                    // charged to the MERCHANT (see InvoiceDto.BoxFeeTotal), never deducted from
                    // what's owed to the farmer, so it's shown here as cargo detail but kept OUT
                    // of the commission math and net-due figures below.
                    if (invoice.BoxFeeTotal > 0)
                        col.Item().AlignRight().Text($"رسم الصناديق (لا يدخل بحساب العمولة): ₪ {invoice.BoxFeeTotal:0.##}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"إجمالي المبيعات: ₪ {invoice.TotalValue:0.##}").FontSize(12);
                    col.Item().AlignRight().Text($"العمولة ({invoice.CommissionRateApplied:0.##%}): - ₪ {invoice.Commission:0.##}").FontColor(Colors.Red.Darken1);
                    col.Item().PaddingTop(2).AlignRight().Text($"الصافي المستحق لهذه الفاتورة: ₪ {invoice.NetDueToFarmer:0.##}").Bold().FontSize(13);
                    if (previousBalance != 0)
                    {
                        col.Item().PaddingTop(2).AlignRight().Text($"الرصيد السابق (رصيد حساب البائع الحالي): ₪ {previousBalance:0.##}").FontSize(10);
                        col.Item().PaddingTop(2).AlignRight().Text($"الإجمالي المستحق: ₪ {(invoice.NetDueToFarmer + previousBalance):0.##}").Bold().FontSize(13);
                    }
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// Bulk-print page requirement: after filtering (by day/week/month/year and/or invoice-number
    /// range), prints every selected invoice as its OWN separate invoice — own header, own items
    /// table, own total, no merging across merchants/traders — four to a physical A4 page, laid
    /// out as a FIXED 2×2 grid of quadrants (top-left/top-right/bottom-left/bottom-right), each
    /// exactly one quarter of the printable area, so the sheet can be cut into 4 afterwards. The
    /// grid is always drawn with all 4 quadrant slots reserved even when a page has fewer than 4
    /// invoices (e.g. the last page, or a small selection) — an empty slot is simply left blank
    /// rather than letting the used quadrants collapse to the top of the page. Invoices are laid
    /// out in the exact order they were passed in (the caller's selected/filtered order — see
    /// InvoiceService.GetManyAsync). Same conventions as the single-invoice PDF: no invoice number
    /// and no commission line (§5) shown on the printed page.
    /// </summary>
    public byte[] GenerateInvoicesBulkPdf(IReadOnlyList<InvoiceDto> invoices, CompanyInfo company)
    {
        const int perPage = 4;
        const int perRow = 2;
        const float margin = 15f;
        const float rowSpacing = 8f;
        const float columnSpacing = 8f;
        // A4 in points (matches PageSizes.A4 — hardcoded here, rather than read back off that
        // struct, so the quadrant math below doesn't depend on exactly which members it exposes).
        const float a4WidthPt = 595f;
        const float a4HeightPt = 842f;

        var contentHeight = a4HeightPt - (margin * 2);
        var rowHeight = (contentHeight - rowSpacing) / (perPage / perRow);

        var pages = invoices
            .Select((invoice, index) => (invoice, index))
            .GroupBy(x => x.index / perPage)
            .Select(g => g.Select(x => x.invoice).ToList())
            .ToList();

        var document = Document.Create(container =>
        {
            foreach (var pageInvoices in pages)
            {
                container.Page(page =>
                {
                    page.Size(a4WidthPt, a4HeightPt);
                    page.Margin(margin);
                    page.DefaultTextStyle(x => x.FontSize(8).FontFamily(PdfFontFamily));

                    // RightToLeft here so the FIRST invoice of each row-group lands in the
                    // rightmost quadrant and the SECOND in the leftmost — matching how an Arabic
                    // reader scans the sheet (right quadrant first, then left, top row before
                    // bottom row) — instead of QuestPDF's plain left-to-right insertion order.
                    // InvoiceCard below explicitly resets back to LeftToRight so this doesn't
                    // also flip the item-name/quantity/price/total column order *inside* each
                    // card, which stays identical to the single-invoice PDF's layout.
                    page.Content().ContentFromRightToLeft().Column(col =>
                    {
                        col.Spacing(rowSpacing);
                        // Always exactly perPage/perRow rows, each reserving a full quadrant's
                        // height — NOT just enough rows for however many invoices landed on this
                        // page — so 1–3 invoices still divide the sheet into 4 equal quarters
                        // instead of bunching up at the top with the rest of the page left blank.
                        for (var slotStart = 0; slotStart < perPage; slotStart += perRow)
                        {
                            col.Item().MinHeight(rowHeight).Row(row =>
                            {
                                row.Spacing(columnSpacing);
                                for (var i = 0; i < perRow; i++)
                                {
                                    var index = slotStart + i;
                                    var cell = row.RelativeItem();
                                    if (index < pageInvoices.Count)
                                        cell.Element(c => InvoiceCard(c, pageInvoices[index], company));
                                    // else: blank quadrant — the cell above still reserves its
                                    // share of the row's width so the grid stays evenly divided.
                                }
                            });
                        }
                    });
                });
            }
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// Bulk-print page's merchant-section print button (explicit request): several invoices for
    /// the SAME merchant on the SAME calendar day print as ONE combined invoice, regardless of
    /// which farmer/driver supplied each one — same layout as GenerateInvoicePdf, just fed a
    /// MergedInvoiceGroupDto's already-summed totals/concatenated items instead of a single
    /// InvoiceDto (see InvoicesController.PrintMerchantMergedPdf for how groups are built), one
    /// page-set per group. A merchant with only one invoice on a given day still gets exactly this
    /// same treatment — a "group" of one invoice renders identically to that invoice's own
    /// single-invoice PDF, just without the quadrant-grid layout GenerateInvoicesBulkPdf uses.
    /// </summary>
    public byte[] GenerateMergedInvoicesPdf(IReadOnlyList<MergedInvoiceGroupDto> groups, CompanyInfo company)
    {
        var document = Document.Create(container =>
        {
            foreach (var group in groups)
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                    page.Margin(30);
                    page.DefaultTextStyle(x => x.FontSize(11).FontFamily(PdfFontFamily));

                    page.Header().ContentFromRightToLeft().Column(col =>
                    {
                        CompanyHeaderBlock(col, company, 64f, textCol =>
                        {
                            textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(18);
                            if (!string.IsNullOrWhiteSpace(company.Address))
                                textCol.Item().AlignCenter().Text(company.Address).FontSize(9).FontColor(Colors.Grey.Darken1);
                            if (!string.IsNullOrWhiteSpace(company.RegistrationNumber))
                                textCol.Item().AlignCenter().Text($"رقم السجل: {company.RegistrationNumber}").FontSize(9);
                            if (!string.IsNullOrWhiteSpace(company.Phone))
                                textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                        });
                        col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                        col.Item().PaddingTop(6).Text("فاتورة مشتري").Bold().FontSize(13);
                        col.Item().PaddingTop(2).Text($"التاريخ: {group.Date:yyyy-MM-dd}").FontSize(11);
                        col.Item().Text($"المطلوب من: {group.MerchantName}").FontSize(11);
                        // البائع/السائق deliberately not shown — same reasoning as GenerateInvoicePdf,
                        // and doubly so here since a merged group can legitimately span several
                        // different farmers/drivers in one combined invoice.
                    });

                    page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                    {
                        table.ColumnsDefinition(columns =>
                        {
                            columns.RelativeColumn(4);
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(2);
                            columns.RelativeColumn(2);
                        });

                        table.Header(header =>
                        {
                            header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                            header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                            header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                            header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                            header.Cell().Element(HeaderCell).AlignRight().Text("س.الخشب");
                            header.Cell().Element(HeaderCell).AlignRight().Text("مجموع كلي");
                        });

                        for (var i = 0; i < group.Items.Count; i++)
                        {
                            var item = group.Items[i];
                            var shaded = i % 2 == 1;
                            var unpriced = item.PricePerUnit == 0;
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.ItemName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Box ? item.Quantity.ToString("0.###") : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Kg ? $"{item.Quantity:0.###} كغم" : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.PricePerUnit.ToString("0.##"));
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.WoodPrice > 0 ? item.WoodPrice.ToString("0.##") : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.LineTotal.ToString("0.##"));
                        }
                    });

                    var totalBoxes = group.Items.Where(i => i.Unit == UnitOfMeasure.Box).Sum(i => i.Quantity);

                    page.Footer().ContentFromRightToLeft().Column(col =>
                    {
                        col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                        if (group.TotalWeightKg > 0)
                            col.Item().AlignRight().Text($"إجمالي الوزن: {group.TotalWeightKg:0.###} كغم");
                        if (totalBoxes > 0)
                            col.Item().AlignRight().Text($"إجمالي الصناديق: {totalBoxes:0.###}");
                        if (group.WoodTotal > 0)
                            col.Item().AlignRight().Text($"إجمالي الخشب: ₪ {group.WoodTotal:0.##}").FontSize(10);
                        if (group.BoxFeeTotal > 0)
                            col.Item().AlignRight().Text($"رسم الصناديق: ₪ {group.BoxFeeTotal:0.##}").FontSize(10);
                        if (group.TransportFee > 0)
                            col.Item().AlignRight().Text($"أجرة النقل: ₪ {group.TransportFee:0.##}").FontSize(10);
                        col.Item().PaddingTop(4).AlignRight().Text($"الإجمالي: ₪ {group.GrandTotal:0.##}").Bold().FontSize(13);
                        if (group.PreviousBalance > 0)
                        {
                            col.Item().AlignRight().Text($"الرصيد السابق: ₪ {group.PreviousBalance:0.##}").FontSize(11);
                            col.Item().PaddingTop(2).AlignRight()
                                .Text($"الإجمالي المستحق: ₪ {(group.GrandTotal + group.PreviousBalance):0.##}").Bold().FontSize(14);
                        }
                    });
                });
            }
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// طباعة فاتورة السائق (bulk-print page's driver section, and the Dashboard's standalone
    /// driver picker): how much أجرة النقل (transport fee) the market owes this driver — one row
    /// per invoice he's attached to, showing that invoice's المشتري and its Invoice.TransportFee,
    /// with a grand total at the bottom. Explicit request: also show, per invoice, العدد (box-unit
    /// item count) and الوزن (kg-unit item weight) alongside the wood price and fare already shown
    /// here — computed straight off that invoice's own Items/TotalWeightKg, same convention every
    /// other quantity column in this app uses (a Box-unit count and a Kg-unit weight side by side,
    /// "—" for whichever one doesn't apply to that invoice's items). Quantity/wood stay purely
    /// informational cargo detail — same as WoodTotal already was — never added into
    /// grandTotal/الرصيد السابق below, which stays transport-fee-only exactly as before.
    /// </summary>
    public byte[] GenerateDriverManifestPdf(string driverName, IReadOnlyList<InvoiceDto> invoices, CompanyInfo company, decimal previousBalance)
    {
        var orderedInvoices = invoices.OrderBy(i => i.Date).ToList();
        var grandTotal = orderedInvoices.Sum(i => i.TransportFee);
        // Informational only — wood/crate price is charged to the MERCHANT, never owed to the
        // driver, so it's shown per-invoice on this manifest (cargo detail) but deliberately kept
        // OUT of grandTotal/الرصيد السابق below, unlike the merchant-facing PDFs where it's part
        // of what's actually due.
        var woodTotal = orderedInvoices.Sum(i => i.WoodTotal);
        // Same "informational cargo detail only" treatment as woodTotal above — never folded into
        // grandTotal, which stays the driver's own transport-fee total.
        var totalBoxes = orderedInvoices.Sum(i => i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => it.Quantity));
        var totalWeightKg = orderedInvoices.Sum(i => i.TotalWeightKg);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف أجرة نقل السائق").Bold().FontSize(14);
                    col.Item().Text($"السائق: {driverName}").FontSize(12);
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(3);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(2);
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("المشتري");
                        header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                        header.Cell().Element(HeaderCell).AlignRight().Text("سعر الخشب");
                        header.Cell().Element(HeaderCell).AlignRight().Text("أجرة النقل");
                    });

                    for (var i = 0; i < orderedInvoices.Count; i++)
                    {
                        var invoice = orderedInvoices[i];
                        var shaded = i % 2 == 1;
                        var boxCount = invoice.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => it.Quantity);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(invoice.MerchantName);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(boxCount > 0 ? boxCount.ToString("0.###") : "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(invoice.TotalWeightKg > 0 ? $"{invoice.TotalWeightKg:0.###} كغم" : "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(invoice.WoodTotal > 0 ? invoice.WoodTotal.ToString("0.##") : "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(invoice.TransportFee.ToString("0.##"));
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    if (totalBoxes > 0)
                        col.Item().AlignRight().Text($"إجمالي الصناديق: {totalBoxes:0.###}").FontSize(9);
                    if (totalWeightKg > 0)
                        col.Item().AlignRight().Text($"إجمالي الوزن: {totalWeightKg:0.###} كغم").FontSize(9);
                    if (woodTotal > 0)
                        col.Item().AlignRight().Text($"إجمالي سعر الخشب (للعلم فقط — ليس من مستحقات السائق): ₪ {woodTotal:0.##}").FontSize(9);
                    col.Item().PaddingTop(4).AlignRight().Text($"إجمالي أجرة النقل: ₪ {grandTotal:0.##}").Bold().FontSize(13);
                    if (previousBalance != 0)
                    {
                        col.Item().PaddingTop(2).AlignRight().Text($"الرصيد السابق (رصيد حساب السائق الحالي): ₪ {previousBalance:0.##}").FontSize(10);
                        col.Item().PaddingTop(2).AlignRight().Text($"الإجمالي المستحق: ₪ {(grandTotal + previousBalance):0.##}").Bold().FontSize(13);
                    }
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// Dashboard "كشف المشترين حسب الفترة" print button: the same period-scoped buyer statement
    /// shown on-screen (see DashboardPage.tsx / IReportService.MerchantReportAsync), but printed
    /// with just اسم المشتري and المبلغ — deliberately NOT عدد الفواتير or the all-time
    /// paid/remaining columns, matching what the user asked to see on paper. Same RTL letterhead
    /// style as the other printed documents, not the plain English SimpleReportToPdf used for the
    /// Reports page's internal Excel/PDF exports.
    /// </summary>
    /// <summary>
    /// Dashboard "كشف المشترين حسب الفترة" print button. Used to print only a flat "اسم المشتري +
    /// المبلغ" list with no item detail at all — every item ever bought during the period silently
    /// collapsed into one number, unlike the on-screen table right above the print button, which
    /// already breaks it down per (merchant, item). Now mirrors that same breakdown: grouped by
    /// merchant (rows already ordered by MerchantName then ItemName — see
    /// ReportService.MerchantItemBreakdownAsync), each item on its own row with العدد/الوزن split
    /// the same way every other item table in this app does (a row is always one or the other, never
    /// both), then a shaded "إجمالي" subtotal row per merchant, and the same overall total in the
    /// footer as before.
    /// </summary>
    public byte[] GenerateBuyerStatementPdf(IReadOnlyList<MerchantItemBreakdownRow> rows, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company)
    {
        var grandTotal = rows.Sum(r => r.TotalValue);
        var merchantGroups = rows
            .GroupBy(r => (r.MerchantId, r.MerchantName))
            .Select(g => (g.Key.MerchantId, g.Key.MerchantName, Items: g.ToList(), Subtotal: g.Sum(x => x.TotalValue)))
            .ToList();

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف المشترين").Bold().FontSize(14);
                    if (dateFrom is not null || dateTo is not null)
                    {
                        var from = dateFrom is not null ? dateFrom.Value.ToString("yyyy-MM-dd") : "البداية";
                        var to = dateTo is not null ? dateTo.Value.ToString("yyyy-MM-dd") : "اليوم";
                        col.Item().Text($"الفترة: من {from} إلى {to}").FontSize(10);
                    }
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(3);   // المشتري
                        columns.RelativeColumn(3);   // الصنف
                        columns.RelativeColumn(2);   // العدد
                        columns.RelativeColumn(2);   // الوزن
                        columns.RelativeColumn(2);   // السعر
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("المشتري");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                        header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                    });

                    var rowIndex = 0;
                    foreach (var group in merchantGroups)
                    {
                        foreach (var item in group.Items)
                        {
                            var shaded = rowIndex % 2 == 1;
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(group.MerchantName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.ItemName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Box ? item.TotalQuantity.ToString("0.###") : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Kg ? $"{item.TotalQuantity:0.###} كغم" : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.TotalValue.ToString("0.##"));
                            rowIndex++;
                        }
                        // Subtotal row for this merchant — shaded regardless of the alternating
                        // stripe above it, so it always reads as a distinct summary line, same
                        // "إجمالي <name>" convention as the Dashboard's own on-screen grouping.
                        table.Cell().ColumnSpan(4).Element(c => DataCell(c, true)).AlignRight().Text($"إجمالي {group.MerchantName}").Bold();
                        table.Cell().Element(c => DataCell(c, true)).AlignRight().Text(group.Subtotal.ToString("0.##")).Bold();
                        rowIndex++;
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"الإجمالي: ₪ {grandTotal:0.##}").Bold().FontSize(13);
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// "طباعة الفواتير" → قسم البائع's "كشف بائع حسب الفترة" print button — farmer counterpart to
    /// GenerateBuyerStatementPdf right above, same layout and same grouped-by-person + subtotal
    /// convention, just بائع instead of مشتري. See FarmerItemBreakdownRow's doc comment for what
    /// TotalValue means here (raw sale value, not net-of-commission).
    /// </summary>
    public byte[] GenerateFarmerItemsStatementPdf(IReadOnlyList<FarmerItemBreakdownRow> rows, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company)
    {
        var grandTotal = rows.Sum(r => r.TotalValue);
        var farmerGroups = rows
            .GroupBy(r => (r.FarmerId, r.FarmerName))
            .Select(g => (g.Key.FarmerId, g.Key.FarmerName, Items: g.ToList(), Subtotal: g.Sum(x => x.TotalValue)))
            .ToList();

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف الباعة").Bold().FontSize(14);
                    if (dateFrom is not null || dateTo is not null)
                    {
                        var from = dateFrom is not null ? dateFrom.Value.ToString("yyyy-MM-dd") : "البداية";
                        var to = dateTo is not null ? dateTo.Value.ToString("yyyy-MM-dd") : "اليوم";
                        col.Item().Text($"الفترة: من {from} إلى {to}").FontSize(10);
                    }
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(3);   // البائع
                        columns.RelativeColumn(3);   // الصنف
                        columns.RelativeColumn(2);   // العدد
                        columns.RelativeColumn(2);   // الوزن
                        columns.RelativeColumn(2);   // السعر
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("البائع");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                        header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                    });

                    var rowIndex = 0;
                    foreach (var group in farmerGroups)
                    {
                        foreach (var item in group.Items)
                        {
                            var shaded = rowIndex % 2 == 1;
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(group.FarmerName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.ItemName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Box ? item.TotalQuantity.ToString("0.###") : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Kg ? $"{item.TotalQuantity:0.###} كغم" : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.TotalValue.ToString("0.##"));
                            rowIndex++;
                        }
                        table.Cell().ColumnSpan(4).Element(c => DataCell(c, true)).AlignRight().Text($"إجمالي {group.FarmerName}").Bold();
                        table.Cell().Element(c => DataCell(c, true)).AlignRight().Text(group.Subtotal.ToString("0.##")).Bold();
                        rowIndex++;
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"الإجمالي: ₪ {grandTotal:0.##}").Bold().FontSize(13);
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// "طباعة الفواتير" → قسم السائق's "كشف سائق حسب الفترة" print button. No "السعر" column here —
    /// see DriverItemBreakdownRow's doc comment for why a per-item price doesn't apply to a driver —
    /// so the subtotal per driver shown in the footer of each group is that driver's own
    /// TotalTransportFee (read once from that driver's first row, never summed across item rows,
    /// which would multiply it by however many distinct items he carried).
    /// </summary>
    public byte[] GenerateDriverItemsStatementPdf(IReadOnlyList<DriverItemBreakdownRow> rows, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company)
    {
        var driverGroups = rows
            .GroupBy(r => (r.DriverId, r.DriverName))
            .Select(g => (g.Key.DriverId, g.Key.DriverName, Items: g.ToList(), TransportFee: g.First().TotalTransportFee))
            .ToList();
        var grandTotal = driverGroups.Sum(g => g.TransportFee);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف السواق").Bold().FontSize(14);
                    if (dateFrom is not null || dateTo is not null)
                    {
                        var from = dateFrom is not null ? dateFrom.Value.ToString("yyyy-MM-dd") : "البداية";
                        var to = dateTo is not null ? dateTo.Value.ToString("yyyy-MM-dd") : "اليوم";
                        col.Item().Text($"الفترة: من {from} إلى {to}").FontSize(10);
                    }
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(3);   // السائق
                        columns.RelativeColumn(3);   // الصنف
                        columns.RelativeColumn(2);   // العدد
                        columns.RelativeColumn(2);   // الوزن
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("السائق");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                    });

                    var rowIndex = 0;
                    foreach (var group in driverGroups)
                    {
                        foreach (var item in group.Items)
                        {
                            var shaded = rowIndex % 2 == 1;
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(group.DriverName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.ItemName);
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Box ? item.TotalQuantity.ToString("0.###") : "—");
                            table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(item.Unit == UnitOfMeasure.Kg ? $"{item.TotalQuantity:0.###} كغم" : "—");
                            rowIndex++;
                        }
                        table.Cell().ColumnSpan(3).Element(c => DataCell(c, true)).AlignRight().Text($"إجمالي أجرة نقل {group.DriverName}").Bold();
                        table.Cell().Element(c => DataCell(c, true)).AlignRight().Text(group.TransportFee.ToString("0.##")).Bold();
                        rowIndex++;
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"إجمالي أجرة النقل: ₪ {grandTotal:0.##}").Bold().FontSize(13);
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// Bulk-print page's "كشف بائع" section (explicit request): a chosen farmer's own item lines
    /// across every one of his Active invoices within a required date range, laid out as ONE
    /// SEPARATE TABLE PER ITEM — the number of tables always matches however many distinct items
    /// (grouped by ItemName+Unit) actually appear in the range, never a single flat table mixing
    /// every item together. Each item's own table lists every occurrence (date/count/weight/price/
    /// wood/line total, chronological) and ends with that item's own "المجموع"/"العمولة"/"الصافي"
    /// line. Per-line commission (CommissionCalculator over LineTotal + that line's own owning
    /// invoice's CommissionRateApplied — never +wood, same base as everywhere else commission is
    /// computed) is summed per item, then all of it is summarized once more at the very end (grand
    /// sales total, grand commission, net due, then previousBalance added on top same as every
    /// other statement PDF in this app).
    /// </summary>
    public byte[] GenerateFarmerStatementPdf(FarmerStatementDto statement, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CompanyInfo company, decimal previousBalance)
    {
        var itemGroups = statement.Lines
            .GroupBy(l => (l.ItemName, l.Unit))
            .Select(g =>
            {
                var groupLines = g.OrderBy(l => l.Date).ToList();
                var subtotal = groupLines.Sum(l => l.LineTotal);
                var woodSubtotal = groupLines.Sum(l => l.WoodPrice);
                var commission = groupLines.Sum(l => CommissionCalculator.Calculate(l.LineTotal, l.CommissionRateApplied).Commission);
                return new
                {
                    g.Key.ItemName,
                    Lines = groupLines,
                    Subtotal = subtotal,
                    WoodSubtotal = woodSubtotal,
                    Commission = commission,
                    Net = subtotal - commission,
                };
            })
            .OrderBy(g => g.ItemName, StringComparer.CurrentCulture)
            .ToList();

        var totalWeightKg = statement.Lines.Where(l => l.Unit == UnitOfMeasure.Kg).Sum(l => l.Quantity);
        var totalBoxes = statement.Lines.Where(l => l.Unit == UnitOfMeasure.Box).Sum(l => l.Quantity);
        var woodTotal = statement.Lines.Sum(l => l.WoodPrice);
        var itemsTotal = statement.Lines.Sum(l => l.LineTotal);
        var totalCommission = itemGroups.Sum(g => g.Commission);
        var netDue = itemsTotal - totalCommission;

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                        if (!string.IsNullOrWhiteSpace(company.Phone))
                            textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(9);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف بائع").Bold().FontSize(14);
                    col.Item().Text($"البائع: {statement.FarmerName}").FontSize(12);
                    if (dateFrom is not null || dateTo is not null)
                    {
                        var from = dateFrom is not null ? dateFrom.Value.ToString("yyyy-MM-dd") : "البداية";
                        var to = dateTo is not null ? dateTo.Value.ToString("yyyy-MM-dd") : "اليوم";
                        col.Item().Text($"الفترة: من {from} إلى {to}").FontSize(10);
                    }
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Column(mainCol =>
                {
                    mainCol.Spacing(14);

                    if (itemGroups.Count == 0)
                    {
                        mainCol.Item().AlignCenter().Text("لا توجد بيانات لهذه الفترة").FontColor(Colors.Grey.Darken1);
                    }

                    foreach (var group in itemGroups)
                    {
                        mainCol.Item().Column(itemCol =>
                        {
                            itemCol.Item().Text(group.ItemName).Bold().FontSize(12);
                            itemCol.Item().Table(table =>
                            {
                                table.ColumnsDefinition(columns =>
                                {
                                    columns.RelativeColumn(2);   // التاريخ
                                    columns.RelativeColumn(2);   // العدد
                                    columns.RelativeColumn(2);   // الوزن
                                    columns.RelativeColumn(2);   // السعر
                                    columns.RelativeColumn(2);   // س.الخشب
                                    columns.RelativeColumn(2);   // مجموع كلي
                                });

                                table.Header(header =>
                                {
                                    header.Cell().Element(HeaderCell).AlignRight().Text("التاريخ");
                                    header.Cell().Element(HeaderCell).AlignRight().Text("العدد");
                                    header.Cell().Element(HeaderCell).AlignRight().Text("الوزن");
                                    header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                                    header.Cell().Element(HeaderCell).AlignRight().Text("س.الخشب");
                                    header.Cell().Element(HeaderCell).AlignRight().Text("مجموع كلي");
                                });

                                for (var i = 0; i < group.Lines.Count; i++)
                                {
                                    var line = group.Lines[i];
                                    var shaded = i % 2 == 1;
                                    var unpriced = line.PricePerUnit == 0;
                                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{line.Date:yyyy-MM-dd}");
                                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(line.Unit == UnitOfMeasure.Box ? line.Quantity.ToString("0.###") : "—");
                                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(line.Unit == UnitOfMeasure.Kg ? $"{line.Quantity:0.###} كغم" : "—");
                                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : line.PricePerUnit.ToString("0.##"));
                                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(line.WoodPrice > 0 ? line.WoodPrice.ToString("0.##") : "—");
                                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : line.LineTotal.ToString("0.##"));
                                }
                            });

                            itemCol.Item().PaddingTop(2).AlignRight().Row(row =>
                            {
                                if (group.WoodSubtotal > 0)
                                    row.AutoItem().PaddingRight(16).Text($"الخشب: ₪ {group.WoodSubtotal:0.##}").FontSize(8).FontColor(Colors.Grey.Darken1);
                                row.AutoItem().PaddingRight(16).Text($"المجموع: ₪ {group.Subtotal:0.##}").Bold();
                                row.AutoItem().PaddingRight(16).Text($"العمولة: - ₪ {group.Commission:0.##}").FontColor(Colors.Red.Darken1);
                                row.AutoItem().Text($"الصافي: ₪ {group.Net:0.##}").Bold();
                            });
                        });
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    if (totalWeightKg > 0)
                        col.Item().AlignRight().Text($"إجمالي الوزن: {totalWeightKg:0.###} كغم");
                    if (totalBoxes > 0)
                        col.Item().AlignRight().Text($"إجمالي الصناديق: {totalBoxes:0.###}");
                    if (woodTotal > 0)
                        col.Item().AlignRight().Text($"إجمالي الخشب: ₪ {woodTotal:0.##}").FontSize(9);
                    col.Item().PaddingTop(4).AlignRight().Text($"إجمالي المبيعات: ₪ {itemsTotal:0.##}").Bold().FontSize(12);
                    col.Item().AlignRight().Text($"إجمالي العمولة: - ₪ {totalCommission:0.##}").FontColor(Colors.Red.Darken1).FontSize(11);
                    col.Item().PaddingTop(2).AlignRight().Text($"الصافي المستحق للبائع: ₪ {netDue:0.##}").Bold().FontSize(13);
                    if (previousBalance != 0)
                    {
                        col.Item().PaddingTop(2).AlignRight().Text($"الرصيد السابق (رصيد حساب البائع الحالي): ₪ {previousBalance:0.##}").FontSize(10);
                        col.Item().PaddingTop(2).AlignRight().Text($"الإجمالي المستحق: ₪ {(netDue + previousBalance):0.##}").Bold().FontSize(13);
                    }
                    col.Item().PaddingTop(6).AlignCenter().DefaultTextStyle(x => x.FontSize(8).FontColor(Colors.Grey.Darken1)).Text(x =>
                    {
                        x.Span("صفحة ");
                        x.CurrentPageNumber();
                        x.Span(" من ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>One quarter-page "card" for GenerateInvoicesBulkPdf — the same content as the
    /// single-invoice PDF (company header, date, merchant, items, total) just shrunk down and
    /// boxed so four of them read as four distinct invoices on one sheet rather than one blob.</summary>
    private void InvoiceCard(IContainer container, InvoiceDto invoice, CompanyInfo company)
    {
        // Explicitly RTL (not just inherited from the caller's page-level setting) so this card
        // renders correctly — right-aligned text, and the item table's "الصنف" column as the
        // RIGHTMOST column (read first) — no matter what context it's ever called from.
        container.ContentFromRightToLeft()
            .Border(1).BorderColor(Colors.Grey.Lighten1).Padding(8).Column(col =>
        {
            // Bug fix: this card used to show only the company name — Address/RegistrationNumber/
            // Phone were never included at all (unlike the single-invoice A4 header, which does
            // show them), so filling those in under Settings had no visible effect on the 4-per-
            // page bulk print. Small font since it's a quarter-page card, but all four fields now
            // match the single-invoice header's set.
            CompanyHeaderBlock(col, company, 28f, textCol =>
            {
                textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(10);
                if (!string.IsNullOrWhiteSpace(company.Address))
                    textCol.Item().AlignCenter().Text(company.Address).FontSize(7).FontColor(Colors.Grey.Darken1);
                if (!string.IsNullOrWhiteSpace(company.RegistrationNumber))
                    textCol.Item().AlignCenter().Text($"رقم السجل: {company.RegistrationNumber}").FontSize(7);
                if (!string.IsNullOrWhiteSpace(company.Phone))
                    textCol.Item().AlignCenter().Text($"هاتف: {company.Phone}").FontSize(7);
            });
            col.Item().Text("فاتورة مشتري").Bold().FontSize(9);
            col.Item().Text($"التاريخ: {invoice.Date:yyyy-MM-dd}").FontSize(8);
            col.Item().Text($"المطلوب من: {invoice.MerchantName}").FontSize(8);
            // البائع/السائق deliberately NOT shown here — same reasoning as GenerateInvoicePdf.
            col.Item().PaddingTop(4).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);

            col.Item().PaddingTop(4).Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(4);
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(2);
                });

                table.Header(header =>
                {
                    header.Cell().Element(MiniHeaderCell).AlignRight().Text("الصنف");
                    header.Cell().Element(MiniHeaderCell).AlignRight().Text("الكمية");
                    header.Cell().Element(MiniHeaderCell).AlignRight().Text("السعر");
                    header.Cell().Element(MiniHeaderCell).AlignRight().Text("الإجمالي");
                });

                for (var i = 0; i < invoice.Items.Count; i++)
                {
                    var item = invoice.Items[i];
                    var shaded = i % 2 == 1;
                    var unpriced = item.PricePerUnit == 0;
                    table.Cell().Element(c => MiniDataCell(c, shaded)).AlignRight().Text(item.ItemName);
                    table.Cell().Element(c => MiniDataCell(c, shaded)).AlignRight().Text($"{item.Quantity:0.###} {ArabicUnitLabel(item.Unit)}");
                    table.Cell().Element(c => MiniDataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.PricePerUnit.ToString("0.##"));
                    table.Cell().Element(c => MiniDataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : item.LineTotal.ToString("0.##"));
                }
            });

            col.Item().PaddingTop(4).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
            // Card is a quarter-page — a per-line wood/transport breakdown doesn't fit, so this
            // shows GrandTotal directly (product + wood + transport) rather than the sub-total
            // breakdown the full single-invoice PDF shows above, plus a compact "منها سعر الخشب"
            // line so the wood/crate charge stays visible instead of disappearing silently into
            // GrandTotal. الرصيد السابق mirrors the single-invoice PDF's own treatment exactly
            // (same InvoiceDto.PreviousBalance, same "add it on top of GrandTotal" behavior).
            if (invoice.WoodTotal > 0)
                col.Item().AlignRight().Text($"منها سعر الخشب: ₪ {invoice.WoodTotal:0.##}").FontSize(7);
            if (invoice.BoxFeeTotal > 0)
                col.Item().AlignRight().Text($"منها رسم الصناديق: ₪ {invoice.BoxFeeTotal:0.##}").FontSize(7);
            col.Item().PaddingTop(2).AlignRight().Text($"الإجمالي: ₪ {invoice.GrandTotal:0.##}").Bold().FontSize(10);
            if (invoice.PreviousBalance > 0)
            {
                col.Item().AlignRight().Text($"الرصيد السابق: ₪ {invoice.PreviousBalance:0.##}").FontSize(7);
                col.Item().PaddingTop(1).AlignRight().Text($"الإجمالي المستحق: ₪ {(invoice.GrandTotal + invoice.PreviousBalance):0.##}").Bold().FontSize(10);
            }
        });
    }

    /// <summary>
    /// Settings → "الشعار": if the market has uploaded a logo, renders it centered on its own
    /// line FIRST, with the given text lines (name / registration number / phone, etc.) stacked
    /// directly underneath it — a classic letterhead layout, logo on top, everything else below
    /// it. With no logo uploaded, renders exactly the same text lines with nothing else, matching
    /// the plain text-only header this app had before the logo-upload feature existed. Shared by
    /// the single-invoice header and the smaller bulk-print card.
    /// </summary>
    private static void CompanyHeaderBlock(ColumnDescriptor col, CompanyInfo company, float logoSize, Action<ColumnDescriptor> textLines)
    {
        if (company.LogoContent is { Length: > 0 })
        {
            col.Item().PaddingBottom(4).AlignCenter().Width(logoSize).Height(logoSize)
                .Image(company.LogoContent).FitArea();
            textLines(col);
        }
        else
        {
            textLines(col);
        }
    }

    /// <summary>Shaded header cell for the shrunk-down invoice-card table used in the 4-per-page
    /// bulk print — same look as HeaderCell, just smaller to fit a quarter page.</summary>
    private static IContainer MiniHeaderCell(IContainer container) =>
        container.Background(Colors.Grey.Lighten3).PaddingVertical(2).PaddingHorizontal(3).DefaultTextStyle(x => x.Bold().FontSize(7));

    /// <summary>Alternating row shading for the shrunk-down invoice-card table — same look as
    /// DataCell, just smaller to fit a quarter page.</summary>
    private static IContainer MiniDataCell(IContainer container, bool shaded) =>
        container.Background(shaded ? Colors.Grey.Lighten4 : Colors.White).PaddingVertical(2).PaddingHorizontal(3).DefaultTextStyle(x => x.FontSize(7));

    /// <summary>Shaded header cell for a "مرتب" (organized) look — grey background, bold text.</summary>
    private static IContainer HeaderCell(IContainer container) =>
        container.Background(Colors.Grey.Lighten2).PaddingVertical(6).PaddingHorizontal(6).DefaultTextStyle(x => x.Bold());

    /// <summary>Alternating row shading plus a thin bottom border, so a long item list stays easy
    /// to scan across a row instead of blurring into one grey block.</summary>
    private static IContainer DataCell(IContainer container, bool shaded) =>
        container.Background(shaded ? Colors.Grey.Lighten4 : Colors.White)
            .BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2)
            .PaddingVertical(5).PaddingHorizontal(6);

    private static string ArabicUnitLabel(UnitOfMeasure unit) => unit switch
    {
        UnitOfMeasure.Kg => "كغم",
        UnitOfMeasure.Box => "صندوق",
        _ => unit.ToString()
    };

    /// <summary>One-page end-of-day summary, printable at the end of a shift. Label/value pairs rather
    /// than a table, since there's only ever one row of data (this one day).</summary>
    public byte[] DailyClosingToPdf(DailyClosingDto closing, string marketName)
    {
        var netCashFlow = closing.PaymentsReceivedFromMerchants - closing.PaymentsPaidToFarmers - closing.TotalExpenses;
        var rows = new (string Label, string Value)[]
        {
            ("Invoices today", closing.InvoiceCount.ToString()),
            ("Total sales value", $"₪ {closing.TotalSalesValue:0.##}"),
            ("Total commission earned", $"₪ {closing.TotalCommission:0.##}"),
            ("Total expenses", $"₪ {closing.TotalExpenses:0.##}"),
            ("Net profit (commission - expenses)", $"₪ {closing.NetProfit:0.##}"),
            ("Payments received from merchants", $"₪ {closing.PaymentsReceivedFromMerchants:0.##}"),
            ("Payments paid to farmers", $"₪ {closing.PaymentsPaidToFarmers:0.##}"),
            ("Net cash flow today", $"₪ {netCashFlow:0.##}"),
        };

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A5);
                page.Margin(25);
                page.DefaultTextStyle(x => x.FontSize(11).FontFamily(PdfFontFamily));

                page.Header().Column(col =>
                {
                    col.Item().Text(marketName).Bold().FontSize(16);
                    col.Item().Text($"Daily Closing — {closing.Date:yyyy-MM-dd}").FontSize(13);
                });

                page.Content().PaddingVertical(15).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(2);
                        columns.RelativeColumn(1);
                    });

                    foreach (var (label, value) in rows)
                    {
                        table.Cell().PaddingVertical(4).Text(label);
                        table.Cell().PaddingVertical(4).AlignRight().Text(value).Bold();
                    }
                });

                page.Footer().AlignRight().Text(x =>
                {
                    x.Span("Printed ");
                    x.Span(DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm"));
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// "قيمة الديون" print button — same 3 sections (الباعة/السواق/المشترين) and Remaining sign
    /// convention as DebtsOverviewPage.tsx's own on-screen table (a section's own "الصافي الإجمالي"
    /// footer is just the sum of that section's own Remaining values, same as the on-screen
    /// DebtSection component computes it), so a full debts review no longer requires opening every
    /// person's own account page one at a time. Same Arabic/RTL statement look as the other
    /// company-header PDFs (GenerateFarmerItemsStatementPdf etc.), not the plain English
    /// SimpleReportToPdf used for the Reports page's internal Excel/PDF exports.
    /// </summary>
    public byte[] GenerateDebtsOverviewPdf(DebtsOverviewDto data, CompanyInfo company)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف قيمة الديون").Bold().FontSize(14);
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Column(col =>
                {
                    col.Spacing(16);
                    DebtsOverviewSection(col.Item(), "الباعة", data.Farmers, "عليه للسوق", "له من السوق");
                    DebtsOverviewSection(col.Item(), "السواق", data.Drivers, "عليه للسوق", "له من السوق");
                    DebtsOverviewSection(col.Item(), "المشترين", data.Merchants, "عليه دين للسوق", "له رصيد زائد (دفع أكتر)");
                });

                page.Footer().ContentFromRightToLeft().AlignCenter().Text(x =>
                {
                    x.Span("صفحة ");
                    x.CurrentPageNumber();
                    x.Span(" من ");
                    x.TotalPages();
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>One section (الباعة/السواق/المشترين) of GenerateDebtsOverviewPdf — a labeled table
    /// of everyone in that group with a non-zero balance, "الحالة" spelling out which of the two
    /// owed-labels applies per Remaining's sign (same as DebtSection's own owedByThemLabel/
    /// owedToThemLabel props), and a shaded "الصافي الإجمالي" total row.</summary>
    private static void DebtsOverviewSection(IContainer container, string title, IReadOnlyList<PartnerDebtRow> rows, string owedByThemLabel, string owedToThemLabel)
    {
        container.Column(col =>
        {
            col.Item().Text($"{title} ({rows.Count})").Bold().FontSize(12);

            if (rows.Count == 0)
            {
                col.Item().PaddingTop(2).Text("لا يوجد أحد عليه أو له رصيد حاليًا").FontSize(9).FontColor(Colors.Grey.Darken1);
                return;
            }

            col.Item().PaddingTop(4).Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(4); // الاسم
                    columns.RelativeColumn(2); // المبلغ
                    columns.RelativeColumn(3); // الحالة
                });

                table.Header(header =>
                {
                    header.Cell().Element(HeaderCell).AlignRight().Text("الاسم");
                    header.Cell().Element(HeaderCell).AlignRight().Text("المبلغ");
                    header.Cell().Element(HeaderCell).AlignRight().Text("الحالة");
                });

                var rowIndex = 0;
                foreach (var r in rows)
                {
                    var shaded = rowIndex % 2 == 1;
                    var status = r.Remaining > 0 ? owedByThemLabel : owedToThemLabel;
                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(r.Name);
                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"₪ {Math.Abs(r.Remaining):0.##}").Bold();
                    table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(status).FontSize(9);
                    rowIndex++;
                }

                var total = rows.Sum(r => r.Remaining);
                table.Cell().Element(c => DataCell(c, true)).AlignRight().Text("الصافي الإجمالي").Bold();
                table.Cell().ColumnSpan(2).Element(c => DataCell(c, true)).AlignRight().Text($"₪ {total:0.##}").Bold();
            });
        });
    }

    /// <summary>
    /// "كشف حساب" print button on a partner's own farmer/driver/merchant account page
    /// (PartnerAccountPage.tsx) — the exact same StatementLineDto rows and running-balance
    /// convention already shown on screen by that page's StatementTable component, so what's on
    /// paper always matches what's on screen. "title" carries which kind this is ("كشف حساب بائع" /
    /// "كشف حساب سائق" / "كشف حساب مشتري") since the same generator serves all three — a Both
    /// partner's two independent statements are two separate print buttons, matching their two
    /// separate on-screen كشف حساب pages.
    /// </summary>
    public byte[] GenerateAccountStatementPdf(string partnerName, string title, IReadOnlyList<StatementLineDto> lines, decimal openingBalance, decimal remaining, CompanyInfo company)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text(title).Bold().FontSize(14);
                    col.Item().Text($"الاسم: {partnerName}").FontSize(12);
                    if (openingBalance != 0)
                        col.Item().Text($"رصيد افتتاحي: ₪ {openingBalance:0.##}").FontSize(9).FontColor(Colors.Grey.Darken1);
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(2); // التاريخ
                        columns.RelativeColumn(3); // الوصف
                        columns.RelativeColumn(4); // التفاصيل
                        columns.RelativeColumn(2); // المبلغ
                        columns.RelativeColumn(2); // الرصيد التراكمي
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("التاريخ");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوصف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("التفاصيل");
                        header.Cell().Element(HeaderCell).AlignRight().Text("المبلغ");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الرصيد التراكمي");
                    });

                    if (lines.Count == 0)
                    {
                        table.Cell().ColumnSpan(5).Element(c => DataCell(c, false)).AlignCenter().Text("لا توجد حركات").FontColor(Colors.Grey.Darken1);
                    }

                    for (var i = 0; i < lines.Count; i++)
                    {
                        var line = lines[i];
                        var shaded = i % 2 == 1;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{line.Date:yyyy-MM-dd}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(line.InvoiceNumber is not null ? $"{line.Description} ({line.InvoiceNumber})" : line.Description);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(StatementLineDetails(line)).FontSize(8);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"₪ {line.Amount:0.##}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"₪ {line.RunningBalance:0.##}").Bold();
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"الرصيد الحالي (المتبقي): ₪ {remaining:0.##}").Bold().FontSize(13);
                    col.Item().PaddingTop(2).AlignCenter().Text(x =>
                    {
                        x.Span("صفحة ");
                        x.CurrentPageNumber();
                        x.Span(" من ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>Same "التفاصيل" join as PartnerAccountPage.tsx's own StatementLineDetails component —
    /// sale value/commission for a farmer Sale line, the recorded method for a payment line, and any
    /// free-text notes — kept as one flat line (not a real line break) since a PDF table cell here
    /// isn't multi-line-friendly the way the on-screen &lt;div&gt; stack is.</summary>
    private static string StatementLineDetails(StatementLineDto line)
    {
        var parts = new List<string>();
        if (line.SaleValue is not null && line.Commission is not null)
        {
            parts.Add($"قيمة المبيعات: ₪ {line.SaleValue:0.##}");
            parts.Add($"العمولة: ₪ {line.Commission:0.##}");
        }
        if (!string.IsNullOrWhiteSpace(line.Method)) parts.Add($"طريقة الدفع: {line.Method}");
        if (!string.IsNullOrWhiteSpace(line.Notes)) parts.Add($"ملاحظة: {line.Notes}");
        return parts.Count > 0 ? string.Join(" — ", parts) : "—";
    }

    /// <summary>
    /// "قيمة الديون" drill-down print button (PartnerInvoiceDetailPage.tsx) — every item line off
    /// every one of this partner's own invoices, all-time, exactly as shown on screen: the itemized
    /// backup a market manager can hand a farmer/driver/merchant to justify the debt figure on
    /// "قيمة الديون". "title" says which side this is ("تفاصيل فواتير بائع/سائق" / "تفاصيل فواتير
    /// مشتري"). No grand total footer — TransportFee/GrandTotal are invoice-level figures repeated
    /// across a multi-item invoice's own rows (see PartnerInvoiceItemLineDto's doc comment), so
    /// summing LineTotal alone (not TransportFee) avoids double-counting anything.
    /// </summary>
    public byte[] GenerateInvoiceDetailPdf(string partnerName, string title, IReadOnlyList<PartnerInvoiceItemLineDto> lines, CompanyInfo company)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text(title).Bold().FontSize(14);
                    col.Item().Text($"الاسم: {partnerName}").FontSize(12);
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(2); // التاريخ
                        columns.RelativeColumn(2); // رقم الفاتورة
                        columns.RelativeColumn(3); // الصنف
                        columns.RelativeColumn(2); // الكمية
                        columns.RelativeColumn(2); // السعر
                        columns.RelativeColumn(2); // إجمالي السطر
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("التاريخ");
                        header.Cell().Element(HeaderCell).AlignRight().Text("رقم الفاتورة");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الكمية");
                        header.Cell().Element(HeaderCell).AlignRight().Text("السعر");
                        header.Cell().Element(HeaderCell).AlignRight().Text("إجمالي السطر");
                    });

                    for (var i = 0; i < lines.Count; i++)
                    {
                        var line = lines[i];
                        var shaded = i % 2 == 1;
                        var unpriced = line.PricePerUnit == 0;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{line.Date:yyyy-MM-dd}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(line.InvoiceNumber);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(line.ItemName);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{line.Quantity:0.###} {ArabicUnitLabel(line.Unit)}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : line.PricePerUnit.ToString("0.##"));
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(unpriced ? "غير مسعّر" : $"₪ {line.LineTotal:0.##}");
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"مجموع قيمة الأصناف: ₪ {lines.Sum(l => l.LineTotal):0.##}").Bold().FontSize(12);
                    col.Item().PaddingTop(2).AlignCenter().Text(x =>
                    {
                        x.Span("صفحة ");
                        x.CurrentPageNumber();
                        x.Span(" من ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    private static string CheckStatusLabel(CheckClearanceStatus? status) => status switch
    {
        CheckClearanceStatus.Cleared => "تم الصرف",
        CheckClearanceStatus.Bounced => "مرتجع",
        _ => "قيد التحصيل"
    };

    /// <summary>
    /// "الشيكات" print button — a register of check payments (Payment.CheckDueDate set), matching
    /// whatever the screen is currently filtered to (status/month — "periodLabel" just describes
    /// that filter in words, e.g. "شهر 2026-08"). Same 3-way status wording as ChecksPage.tsx's own
    /// STATUS_LABELS. Only the "قيد التحصيل" total is footed — those are the only ones still an open
    /// obligation; Cleared already happened and Bounced never counted (see
    /// CheckClearanceStatus.Bounced's doc comment).
    /// </summary>
    public byte[] GenerateChecksPdf(IReadOnlyList<PaymentDto> checks, CompanyInfo company, string? periodLabel)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف الشيكات").Bold().FontSize(14);
                    if (!string.IsNullOrWhiteSpace(periodLabel))
                        col.Item().Text(periodLabel).FontSize(10);
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(2); // تاريخ الاستحقاق
                        columns.RelativeColumn(3); // الشخص
                        columns.RelativeColumn(2); // الاتجاه
                        columns.RelativeColumn(2); // القيمة
                        columns.RelativeColumn(2); // رقم الشيك
                        columns.RelativeColumn(2); // الفاتورة
                        columns.RelativeColumn(2); // الحالة
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("تاريخ الاستحقاق");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الشخص");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الاتجاه");
                        header.Cell().Element(HeaderCell).AlignRight().Text("القيمة");
                        header.Cell().Element(HeaderCell).AlignRight().Text("رقم الشيك");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الفاتورة");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الحالة");
                    });

                    for (var i = 0; i < checks.Count; i++)
                    {
                        var c = checks[i];
                        var shaded = i % 2 == 1;
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text(c.CheckDueDate is not null ? $"{c.CheckDueDate:yyyy-MM-dd}" : "—");
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text(c.PartnerName);
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text(c.Direction == PaymentDirection.ToFarmer ? "للبائع/السائق" : "من المشتري");
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text($"₪ {c.Amount:0.##}").Bold();
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text(c.CheckNumber ?? "—");
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text(c.InvoiceNumber ?? "—");
                        table.Cell().Element(cc => DataCell(cc, shaded)).AlignRight().Text(CheckStatusLabel(c.CheckStatus)).FontSize(8);
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    var pendingTotal = checks.Where(c => c.CheckStatus == CheckClearanceStatus.Pending).Sum(c => c.Amount);
                    col.Item().PaddingTop(4).AlignRight().Text($"إجمالي الشيكات قيد التحصيل: ₪ {pendingTotal:0.##}").Bold().FontSize(12);
                    col.Item().PaddingTop(2).AlignCenter().Text(x =>
                    {
                        x.Span("صفحة ");
                        x.CurrentPageNumber();
                        x.Span(" من ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>
    /// "الدفعات" tab print button (PaymentsPage.tsx) — the recorded payment list, optionally
    /// date-ranged to match whatever filter the screen is showing. Two separate totals (ToFarmer vs
    /// FromMerchant) since they're two different ledgers, never one combined number — same
    /// convention as every other دفعات figure in this app.
    /// </summary>
    public byte[] GeneratePaymentsListPdf(IReadOnlyList<PaymentDto> payments, CompanyInfo company, DateTimeOffset? dateFrom, DateTimeOffset? dateTo)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف الدفعات").Bold().FontSize(14);
                    if (dateFrom is not null || dateTo is not null)
                    {
                        var from = dateFrom is not null ? dateFrom.Value.ToString("yyyy-MM-dd") : "البداية";
                        var to = dateTo is not null ? dateTo.Value.ToString("yyyy-MM-dd") : "اليوم";
                        col.Item().Text($"الفترة: من {from} إلى {to}").FontSize(10);
                    }
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(2); // التاريخ
                        columns.RelativeColumn(3); // الشخص
                        columns.RelativeColumn(2); // الاتجاه
                        columns.RelativeColumn(2); // المبلغ
                        columns.RelativeColumn(2); // الفاتورة
                        columns.RelativeColumn(2); // طريقة الدفع
                        columns.RelativeColumn(3); // ملاحظات
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("التاريخ");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الشخص");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الاتجاه");
                        header.Cell().Element(HeaderCell).AlignRight().Text("المبلغ");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الفاتورة");
                        header.Cell().Element(HeaderCell).AlignRight().Text("طريقة الدفع");
                        header.Cell().Element(HeaderCell).AlignRight().Text("ملاحظات");
                    });

                    for (var i = 0; i < payments.Count; i++)
                    {
                        var p = payments[i];
                        var shaded = i % 2 == 1;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{p.Date:yyyy-MM-dd}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(p.PartnerName);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(p.Direction == PaymentDirection.ToFarmer ? "للبائع/السائق" : "من المشتري");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"₪ {p.Amount:0.##}").Bold();
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(p.InvoiceNumber ?? "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(p.Method ?? "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(p.Notes ?? "—").FontSize(8);
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    var toFarmerTotal = payments.Where(p => p.Direction == PaymentDirection.ToFarmer).Sum(p => p.Amount);
                    var fromMerchantTotal = payments.Where(p => p.Direction == PaymentDirection.FromMerchant).Sum(p => p.Amount);
                    col.Item().PaddingTop(4).AlignRight().Text($"إجمالي الدفعات للباعة/السواق: ₪ {toFarmerTotal:0.##}").FontSize(10);
                    col.Item().AlignRight().Text($"إجمالي الدفعات من المشترين: ₪ {fromMerchantTotal:0.##}").FontSize(10);
                    col.Item().PaddingTop(2).AlignCenter().Text(x =>
                    {
                        x.Span("صفحة ");
                        x.CurrentPageNumber();
                        x.Span(" من ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>"مصاريف الحسبة" tab print button (PaymentsPage.tsx) — the recorded expense list,
    /// optionally date-ranged to match whatever filter the screen is showing.</summary>
    public byte[] GenerateExpensesListPdf(IReadOnlyList<ExpenseDto> expenses, CompanyInfo company, DateTimeOffset? dateFrom, DateTimeOffset? dateTo)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("كشف مصاريف الحسبة").Bold().FontSize(14);
                    if (dateFrom is not null || dateTo is not null)
                    {
                        var from = dateFrom is not null ? dateFrom.Value.ToString("yyyy-MM-dd") : "البداية";
                        var to = dateTo is not null ? dateTo.Value.ToString("yyyy-MM-dd") : "اليوم";
                        col.Item().Text($"الفترة: من {from} إلى {to}").FontSize(10);
                    }
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(2); // التاريخ
                        columns.RelativeColumn(4); // الوصف
                        columns.RelativeColumn(2); // الفئة
                        columns.RelativeColumn(2); // الموظف
                        columns.RelativeColumn(2); // المبلغ
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("التاريخ");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوصف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الفئة");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الموظف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("المبلغ");
                    });

                    for (var i = 0; i < expenses.Count; i++)
                    {
                        var e = expenses[i];
                        var shaded = i % 2 == 1;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{e.Date:yyyy-MM-dd}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(e.Description);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(e.Category ?? "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(e.EmployeeName ?? "—");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"₪ {e.Amount:0.##}").Bold();
                    }
                });

                page.Footer().ContentFromRightToLeft().Column(col =>
                {
                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(4).AlignRight().Text($"الإجمالي: ₪ {expenses.Sum(e => e.Amount):0.##}").Bold().FontSize(12);
                    col.Item().PaddingTop(2).AlignCenter().Text(x =>
                    {
                        x.Span("صفحة ");
                        x.CurrentPageNumber();
                        x.Span(" من ");
                        x.TotalPages();
                    });
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>"بضاعة الباعة" print button — the currently-picked farmer's own "المخزون المتوفر
    /// حاليًا" table (received/sold/available/wood), exactly as shown on FarmerGoodsPage.tsx, usable
    /// as a stock hand-over/reconciliation sheet. No grand total footer — quantities mix Kg and Box
    /// units across rows, so a single summed number would be meaningless.</summary>
    public byte[] GenerateFarmerGoodsStockPdf(string farmerName, IReadOnlyList<GoodsStockRow> stock, CompanyInfo company)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(30);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily(PdfFontFamily));

                page.Header().ContentFromRightToLeft().Column(col =>
                {
                    CompanyHeaderBlock(col, company, 50f, textCol =>
                    {
                        textCol.Item().AlignCenter().Text(company.Name).Bold().FontSize(15);
                    });
                    col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Darken1);
                    col.Item().PaddingTop(6).AlignCenter().Text("المخزون المتوفر حاليًا").Bold().FontSize(14);
                    col.Item().Text($"البائع: {farmerName}").FontSize(12);
                    col.Item().Text($"تاريخ الطباعة: {DateTimeOffset.Now:yyyy-MM-dd}").FontSize(9).FontColor(Colors.Grey.Darken1);
                });

                page.Content().ContentFromRightToLeft().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(3); // الصنف
                        columns.RelativeColumn(2); // الوحدة
                        columns.RelativeColumn(2); // الوارد
                        columns.RelativeColumn(2); // المباع
                        columns.RelativeColumn(2); // المتوفر
                        columns.RelativeColumn(2); // صناديق خشب
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell).AlignRight().Text("الصنف");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوحدة");
                        header.Cell().Element(HeaderCell).AlignRight().Text("الوارد");
                        header.Cell().Element(HeaderCell).AlignRight().Text("المباع");
                        header.Cell().Element(HeaderCell).AlignRight().Text("المتوفر");
                        header.Cell().Element(HeaderCell).AlignRight().Text("صناديق خشب");
                    });

                    for (var i = 0; i < stock.Count; i++)
                    {
                        var r = stock[i];
                        var shaded = i % 2 == 1;
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(r.ItemName);
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(ArabicUnitLabel(r.Unit));
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{r.TotalReceived:0.###}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{r.TotalSold:0.###}");
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text($"{r.Available:0.###}").Bold();
                        table.Cell().Element(c => DataCell(c, shaded)).AlignRight().Text(r.WoodReceived > 0 ? $"{r.WoodReceived:0.###}" : "—");
                    }
                });

                page.Footer().ContentFromRightToLeft().AlignCenter().Text(x =>
                {
                    x.Span("صفحة ");
                    x.CurrentPageNumber();
                    x.Span(" من ");
                    x.TotalPages();
                });
            });
        });

        return document.GeneratePdf();
    }

    /// <summary>Generic tabular PDF for the three report types — one layout, headers/rows supplied by the caller.</summary>
    public byte[] SimpleReportToPdf(string title, string[] headers, IEnumerable<string[]> rows)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(25);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily(PdfFontFamily));

                page.Header().Text(title).Bold().FontSize(16);

                page.Content().PaddingVertical(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        foreach (var _ in headers) columns.RelativeColumn();
                    });

                    table.Header(header =>
                    {
                        foreach (var h in headers) header.Cell().Text(h).Bold();
                    });

                    foreach (var row in rows)
                    {
                        foreach (var cell in row) table.Cell().Text(cell);
                    }
                });

                page.Footer().AlignRight().Text(x =>
                {
                    x.Span("Generated ");
                    x.Span(DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm"));
                });
            });
        });

        return document.GeneratePdf();
    }

    private static byte[] ToBytes(XLWorkbook workbook)
    {
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
