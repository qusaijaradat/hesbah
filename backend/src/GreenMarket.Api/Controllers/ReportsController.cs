using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §8: farmer/merchant/market reports, all filterable + printable + exportable.</summary>
[ApiController]
[Authorize]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private readonly IReportService _reportService;
    private readonly IExportService _exportService;
    private readonly ISettingsService _settingsService;

    public ReportsController(IReportService reportService, IExportService exportService, ISettingsService settingsService)
    {
        _reportService = reportService;
        _exportService = exportService;
        _settingsService = settingsService;
    }

    [HttpGet("daily-closing")]
    [RequirePermission(PermissionKeys.ReportsView)]
    public async Task<ActionResult<DailyClosingDto>> DailyClosing([FromQuery] DateTimeOffset date) =>
        Ok(await _reportService.DailyClosingAsync(date));

    [HttpGet("daily-closing/export/pdf")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> DailyClosingPdf([FromQuery] DateTimeOffset date)
    {
        var closing = await _reportService.DailyClosingAsync(date);
        var marketName = (await _settingsService.ListAsync()).FirstOrDefault(s => s.Key == Setting.Keys.MarketName)?.Value ?? "Green Market";
        return PdfFile(_exportService.DailyClosingToPdf(closing, marketName), $"daily-closing-{closing.Date:yyyy-MM-dd}.pdf");
    }

    [HttpGet("farmers")]
    [RequirePermission(PermissionKeys.ReportsView)]
    public async Task<ActionResult<IReadOnlyList<FarmerReportRow>>> Farmers([FromQuery] ReportFilterRequest filter) =>
        Ok(await _reportService.FarmerReportAsync(filter));

    [HttpGet("merchants")]
    [RequirePermission(PermissionKeys.ReportsView)]
    public async Task<ActionResult<IReadOnlyList<MerchantReportRow>>> Merchants([FromQuery] ReportFilterRequest filter) =>
        Ok(await _reportService.MerchantReportAsync(filter));

    [HttpGet("market")]
    [RequirePermission(PermissionKeys.ReportsView)]
    public async Task<ActionResult<IReadOnlyList<MarketReportRow>>> Market([FromQuery] ReportFilterRequest filter) =>
        Ok(await _reportService.MarketReportAsync(filter));

    [HttpGet("aging")]
    [RequirePermission(PermissionKeys.ReportsView)]
    public async Task<ActionResult<IReadOnlyList<AgingReportRow>>> Aging([FromQuery] ReportFilterRequest filter) =>
        Ok(await _reportService.AgingReportAsync(filter));

    [HttpGet("aging/export/excel")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> AgingExcel([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.AgingReportAsync(filter);
        return ExcelFile(_exportService.AgingReportToExcel(rows), "aging-report.xlsx");
    }

    [HttpGet("aging/export/pdf")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> AgingPdf([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.AgingReportAsync(filter);
        var headers = new[] { "Merchant", "Current (<30d)", "30-59 days", "60-89 days", "90+ days", "Total (₪)" };
        var body = rows.Select(r => new[]
        {
            r.MerchantName, r.Current.ToString("0.##"), r.Days30To59.ToString("0.##"),
            r.Days60To89.ToString("0.##"), r.Days90Plus.ToString("0.##"), r.Total.ToString("0.##")
        });
        return PdfFile(_exportService.SimpleReportToPdf("Aging Report", headers, body), "aging-report.pdf");
    }

    [HttpGet("farmers/export/excel")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> FarmersExcel([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.FarmerReportAsync(filter);
        return ExcelFile(_exportService.FarmerReportToExcel(rows), "farmer-report.xlsx");
    }

    [HttpGet("merchants/export/excel")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> MerchantsExcel([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.MerchantReportAsync(filter);
        return ExcelFile(_exportService.MerchantReportToExcel(rows), "merchant-report.xlsx");
    }

    [HttpGet("market/export/excel")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> MarketExcel([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.MarketReportAsync(filter);
        return ExcelFile(_exportService.MarketReportToExcel(rows), "market-report.xlsx");
    }

    [HttpGet("farmers/export/pdf")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> FarmersPdf([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.FarmerReportAsync(filter);
        var headers = new[] { "Farmer", "Invoices", "Weight (kg)", "Sales (₪)", "Commission (₪)", "Paid (₪)", "Remaining (₪)" };
        var body = rows.Select(r => new[]
        {
            r.FarmerName, r.InvoiceCount.ToString(), r.TotalWeightKg.ToString("0.###"),
            r.TotalSalesValue.ToString("0.##"), r.TotalCommission.ToString("0.##"),
            r.TotalPaid.ToString("0.##"), r.Remaining.ToString("0.##")
        });
        return PdfFile(_exportService.SimpleReportToPdf("Farmer Report", headers, body), "farmer-report.pdf");
    }

    [HttpGet("merchants/export/pdf")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> MerchantsPdf([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.MerchantReportAsync(filter);
        var headers = new[] { "Merchant", "Invoices", "Purchases (₪)", "Paid (₪)", "Remaining (₪)" };
        var body = rows.Select(r => new[]
        {
            r.MerchantName, r.InvoiceCount.ToString(), r.TotalPurchases.ToString("0.##"),
            r.TotalPaid.ToString("0.##"), r.Remaining.ToString("0.##")
        });
        return PdfFile(_exportService.SimpleReportToPdf("Merchant Report", headers, body), "merchant-report.pdf");
    }

    [HttpGet("market/export/pdf")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> MarketPdf([FromQuery] ReportFilterRequest filter)
    {
        var rows = await _reportService.MarketReportAsync(filter);
        var headers = new[] { "Period", "Sales (₪)", "Commission (₪)", "Expenses (₪)", "Net Profit (₪)" };
        var body = rows.Select(r => new[]
        {
            r.Period, r.TotalSalesValue.ToString("0.##"), r.TotalCommission.ToString("0.##"),
            r.TotalExpenses.ToString("0.##"), r.NetProfit.ToString("0.##")
        });
        return PdfFile(_exportService.SimpleReportToPdf("Market Report", headers, body), "market-report.pdf");
    }

    private FileContentResult ExcelFile(byte[] bytes, string fileName) =>
        File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);

    private FileContentResult PdfFile(byte[] bytes, string fileName) =>
        File(bytes, "application/pdf", fileName);
}
