using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §4 (create), §7 (filter/search), §9 (print/WhatsApp PDF).</summary>
[ApiController]
[Authorize]
[Route("api/invoices")]
public class InvoicesController : ControllerBase
{
    private readonly IInvoiceService _invoiceService;
    private readonly IExportService _exportService;
    private readonly ISettingsService _settingsService;
    private readonly ICompanyLogoService _logoService;

    public InvoicesController(IInvoiceService invoiceService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService)
    {
        _invoiceService = invoiceService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult> List([FromQuery] InvoiceFilterRequest filter) => Ok(await _invoiceService.ListAsync(filter));

    [HttpGet("{id:int}")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<InvoiceDto>> Get(int id) => Ok(await _invoiceService.GetAsync(id));

    [HttpPost]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    public async Task<ActionResult<InvoiceDto>> Create(CreateInvoiceRequest request) => Ok(await _invoiceService.CreateAsync(request));

    /// <summary>Corrects an Active invoice's date/merchant/farmer/items in place (recomputing
    /// totals and commission, and keeping the linked farmer ledger row in sync) instead of forcing
    /// a cancel-and-recreate for a simple mistake. Cancelled invoices can't be edited.</summary>
    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.InvoicesEdit)]
    public async Task<ActionResult<InvoiceDto>> Update(int id, CreateInvoiceRequest request) =>
        Ok(await _invoiceService.UpdateAsync(id, request));

    [HttpPost("{id:int}/cancel")]
    [RequirePermission(PermissionKeys.InvoicesCancel)]
    public async Task<ActionResult<InvoiceDto>> Cancel(int id, CancelInvoiceRequest request) =>
        Ok(await _invoiceService.CancelAsync(id, request, CurrentUserId.Require(User)));

    [HttpGet("{id:int}/pdf")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<IActionResult> Pdf(int id, [FromQuery] bool thermal = false)
    {
        var invoice = await _invoiceService.GetAsync(id);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateInvoicePdf(invoice, company, thermal);
        return File(bytes, "application/pdf", $"{invoice.InvoiceNumber}.pdf");
    }

    /// <summary>
    /// Full item-level detail for a set of invoices — used by the bulk-print page to build the
    /// same Arabic per-trader WhatsApp statement text as the printed PDF (same template, either
    /// destination).
    /// </summary>
    [HttpGet("batch")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<IReadOnlyList<InvoiceDto>>> Batch([FromQuery] List<int> ids)
    {
        if (ids is null || ids.Count == 0) return Ok(Array.Empty<InvoiceDto>());
        return Ok(await _invoiceService.GetManyAsync(ids));
    }

    /// <summary>Bulk-print page: the selected (already filtered) invoices, each printed as its
    /// own separate invoice (own header/items/total, no merging across merchants), four to a
    /// physical A4 page.</summary>
    [HttpGet("print/pdf")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<IActionResult> PrintBulkPdf([FromQuery] List<int> ids)
    {
        if (ids is null || ids.Count == 0)
            return BadRequest(new { error = "يرجى اختيار فاتورة واحدة على الأقل." });

        var invoices = await _invoiceService.GetManyAsync(ids);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateInvoicesBulkPdf(invoices, company);
        return File(bytes, "application/pdf", "invoices-bulk.pdf");
    }

    /// <summary>Bulk-print page's "طباعة فواتير السائق" section: the caller has already grouped
    /// the selected invoices by driver client-side (see BulkPrintPage.tsx driverGroups) and passes
    /// one driver's invoice ids at a time — this collects every item across all of them into one
    /// consolidated hand-over sheet grouped by farmer/seller, instead of one printout per invoice.</summary>
    [HttpGet("print/driver-manifest/pdf")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<IActionResult> PrintDriverManifestPdf([FromQuery] List<int> ids)
    {
        if (ids is null || ids.Count == 0)
            return BadRequest(new { error = "يرجى اختيار فاتورة واحدة على الأقل." });

        var invoices = await _invoiceService.GetManyAsync(ids);
        var driverName = invoices.Select(i => i.DriverName).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)) ?? "غير محدد";
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateDriverManifestPdf(driverName, invoices, company);
        return File(bytes, "application/pdf", "driver-manifest.pdf");
    }

    /// <summary>Builds the printed header's company-identity block entirely from Settings, so the
    /// market can fill in its own name/address/phone/registration number without a code change.</summary>
    private async Task<CompanyInfo> GetCompanyInfoAsync()
    {
        var settings = await _settingsService.ListAsync();
        string? Get(string key)
        {
            var value = settings.FirstOrDefault(s => s.Key == key)?.Value;
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        // Falls back to the bundled "أرديس" logo when the market hasn't uploaded their own yet —
        // see CompanyLogoService.GetEffectiveLogoAsync.
        var (logoContent, _) = await _logoService.GetEffectiveLogoAsync();

        return new CompanyInfo(
            Get(Setting.Keys.MarketName) ?? "Green Market",
            Get(Setting.Keys.Address),
            Get(Setting.Keys.Phone),
            Get(Setting.Keys.RegistrationNumber),
            logoContent);
    }

    [HttpGet("export/excel")]
    [RequirePermission(PermissionKeys.ReportsExport)]
    public async Task<IActionResult> ExportExcel([FromQuery] InvoiceFilterRequest filter)
    {
        filter.Page = 1;
        filter.PageSize = 10_000; // exports ignore pagination — requirement doc §7 "after filtering, export everything"
        var result = await _invoiceService.ListAsync(filter);
        var bytes = _exportService.InvoicesToExcel(result.Items.ToList());
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "invoices.xlsx");
    }
}
