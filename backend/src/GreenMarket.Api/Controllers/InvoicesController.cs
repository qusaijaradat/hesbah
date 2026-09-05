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
    private readonly IPartnerService _partnerService;

    public InvoicesController(IInvoiceService invoiceService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService, IPartnerService partnerService)
    {
        _invoiceService = invoiceService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
        _partnerService = partnerService;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult> List([FromQuery] InvoiceFilterRequest filter) => Ok(await _invoiceService.ListAsync(filter));

    [HttpGet("{id:int}")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<InvoiceDto>> Get(int id) => Ok(await _invoiceService.GetAsync(id));

    [HttpPost]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    public async Task<ActionResult<InvoiceDto>> Create(CreateInvoiceRequest request) =>
        Ok(await _invoiceService.CreateAsync(request, CurrentUserId.Require(User)));

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

    /// <summary>"نسخة البائع" print button on the invoice detail page — only offered when the
    /// invoice has a farmer attached. Unlike the plain Pdf action above, this copy DOES show and
    /// deduct this invoice's own commission (see ExportService.GenerateFarmerInvoicePdf's own doc
    /// comment) — the commission-hidden merchant copy is untouched by this endpoint entirely.</summary>
    [HttpGet("{id:int}/farmer-pdf")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<IActionResult> FarmerPdf(int id)
    {
        var invoice = await _invoiceService.GetAsync(id);
        if (invoice.FarmerId is null)
            return BadRequest(new { error = "لا يوجد بائع مرتبط بهذه الفاتورة." });

        var previousBalance = (await _partnerService.GetFarmerAccountAsync(invoice.FarmerId.Value)).Remaining;
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateFarmerInvoicePdf(invoice, company, previousBalance);
        return File(bytes, "application/pdf", $"{invoice.InvoiceNumber}-farmer-copy.pdf");
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

    /// <summary>Bulk-print page's merchant-section print button (explicit request): several
    /// invoices for the SAME merchant on the SAME calendar day print as ONE combined invoice,
    /// regardless of which farmer/driver supplied each one. Groups the selected invoices by
    /// (MerchantId, calendar day), computes each group's own previous balance the same way the
    /// merchant-group WhatsApp send already does (excluding every invoice in that WHOLE group at
    /// once — see GetMerchantGroupPreviousBalanceAsync's doc comment), then hands every group to
    /// ExportService.GenerateMergedInvoicesPdf as one combined PDF (one page-set per group).</summary>
    [HttpGet("print/merchant-merged/pdf")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<IActionResult> PrintMerchantMergedPdf([FromQuery] List<int> ids)
    {
        if (ids is null || ids.Count == 0)
            return BadRequest(new { error = "يرجى اختيار فاتورة واحدة على الأقل." });

        var invoices = await _invoiceService.GetManyAsync(ids);
        var groups = invoices
            .GroupBy(i => (i.MerchantId, Day: i.Date.Date))
            .OrderBy(g => g.Key.Day).ThenBy(g => g.First().MerchantName)
            .ToList();

        var mergedGroups = new List<MergedInvoiceGroupDto>();
        foreach (var g in groups)
        {
            var groupInvoices = g.ToList();
            var previousBalance = await _invoiceService.GetMerchantGroupPreviousBalanceAsync(
                g.Key.MerchantId, groupInvoices.Select(i => i.Id).ToList());
            mergedGroups.Add(new MergedInvoiceGroupDto(
                groupInvoices[0].MerchantName,
                (DateTimeOffset)g.Key.Day,
                groupInvoices.SelectMany(i => i.Items).ToList(),
                groupInvoices.Sum(i => i.TotalWeightKg),
                groupInvoices.Sum(i => i.TotalValue),
                groupInvoices.Sum(i => i.WoodTotal),
                groupInvoices.Sum(i => i.TransportFee),
                groupInvoices.Sum(i => i.GrandTotal),
                previousBalance));
        }

        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateMergedInvoicesPdf(mergedGroups, company);
        return File(bytes, "application/pdf", "invoices-merchant-merged.pdf");
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
        var driverId = invoices.Select(i => i.DriverId).FirstOrDefault(id => id is not null);
        // "الرصيد السابق" here is this driver's own account balance right now — same كشف حساب
        // Remaining their account page shows (see AskUserQuestion decision: farmer/driver previous
        // balance means their CURRENT balance, not a batch-excluded figure like the merchant's).
        var previousBalance = driverId is not null ? (await _partnerService.GetFarmerAccountAsync(driverId.Value)).Remaining : 0;
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateDriverManifestPdf(driverName, invoices, company, previousBalance);
        return File(bytes, "application/pdf", "driver-manifest.pdf");
    }

    /// <summary>Bulk-print page's "كشف بائع" section: a chosen farmer's own itemized statement for
    /// a required date range — every item line off every one of his Active invoices in that range,
    /// one continuous PDF (not one page per invoice/date). Both dates are required by the frontend
    /// before this is even called, so there's no "entire history" accidental print.</summary>
    [HttpGet("print/farmer-statement/pdf")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<IActionResult> PrintFarmerStatementPdf([FromQuery] int farmerId, [FromQuery] DateTimeOffset? dateFrom, [FromQuery] DateTimeOffset? dateTo)
    {
        var statement = await _invoiceService.GetFarmerStatementAsync(farmerId, dateFrom, dateTo);
        if (statement.Lines.Count == 0)
            return BadRequest(new { error = "لا توجد فواتير لهذا البائع ضمن الفترة المحددة." });

        // Same "current account balance right now" convention as the driver manifest above.
        var previousBalance = (await _partnerService.GetFarmerAccountAsync(farmerId)).Remaining;
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateFarmerStatementPdf(statement, dateFrom, dateTo, company, previousBalance);
        return File(bytes, "application/pdf", "farmer-statement.pdf");
    }

    /// <summary>Standalone "بضاعة الباعة" page: a chosen farmer's goods, grouped by day + item +
    /// unit, over an optional date range (omit both to see his entire history at once).</summary>
    [HttpGet("farmer-goods")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<FarmerGoodsDto>> FarmerGoods([FromQuery] int farmerId, [FromQuery] DateTimeOffset? dateFrom, [FromQuery] DateTimeOffset? dateTo) =>
        Ok(await _invoiceService.GetFarmerGoodsAsync(farmerId, dateFrom, dateTo));

    /// <summary>BulkPrintPage's merchant-section grouped WhatsApp send: "الرصيد السابق" for a
    /// message bundling several of this merchant's invoices together (see
    /// IInvoiceService.GetMerchantGroupPreviousBalanceAsync's doc comment for why this can't just
    /// reuse one invoice's own PreviousBalance field).</summary>
    [HttpGet("merchant-previous-balance")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<decimal>> MerchantGroupPreviousBalance([FromQuery] int merchantId, [FromQuery] List<int> invoiceIds) =>
        Ok(await _invoiceService.GetMerchantGroupPreviousBalanceAsync(merchantId, invoiceIds ?? new List<int>()));

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
