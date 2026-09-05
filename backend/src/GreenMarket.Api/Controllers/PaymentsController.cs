using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §6: recording payments and linking them to accounts.</summary>
[ApiController]
[Authorize]
[Route("api/payments")]
public class PaymentsController : ControllerBase
{
    private readonly IPaymentService _paymentService;
    private readonly IExportService _exportService;
    private readonly ISettingsService _settingsService;
    private readonly ICompanyLogoService _logoService;

    public PaymentsController(IPaymentService paymentService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService)
    {
        _paymentService = paymentService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.PaymentsView)]
    public async Task<ActionResult> List(int? partnerId, int page = 1, int pageSize = 25) =>
        Ok(await _paymentService.ListAsync(partnerId, page, pageSize));

    /// <summary>"الشيكات" page — every payment recorded as a check, soonest-due first, optionally
    /// narrowed to one status. Same PaymentsView permission as the rest of this controller — it's a
    /// specialized view over the same payments table, not a separate feature.</summary>
    [HttpGet("checks")]
    [RequirePermission(PermissionKeys.PaymentsView)]
    public async Task<ActionResult> ListChecks(CheckClearanceStatus? status, DateTimeOffset? dueFrom, DateTimeOffset? dueTo, int page = 1, int pageSize = 50) =>
        Ok(await _paymentService.ListChecksAsync(status, dueFrom, dueTo, page, pageSize));

    /// <summary>"الشيكات" print button — see ExportService.GenerateChecksPdf's own doc comment. Same
    /// status/dueFrom/dueTo filters as ListChecks above, so the PDF always matches whatever the
    /// screen is currently filtered to.</summary>
    [HttpGet("checks/print/pdf")]
    [RequirePermission(PermissionKeys.PaymentsView)]
    public async Task<IActionResult> PrintChecksPdf(CheckClearanceStatus? status, DateTimeOffset? dueFrom, DateTimeOffset? dueTo, string? periodLabel)
    {
        var result = await _paymentService.ListChecksAsync(status, dueFrom, dueTo, 1, 10000);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateChecksPdf(result.Items, company, periodLabel);
        return File(bytes, "application/pdf", "checks.pdf");
    }

    /// <summary>"الدفعات" tab print button — see ExportService.GeneratePaymentsListPdf's own doc
    /// comment. Same optional date range as the reports/statements elsewhere in the app.</summary>
    [HttpGet("print/pdf")]
    [RequirePermission(PermissionKeys.PaymentsView)]
    public async Task<IActionResult> PrintPaymentsPdf(DateTimeOffset? from, DateTimeOffset? to)
    {
        var result = await _paymentService.ListAsync(null, 1, 10000);
        var items = result.Items.Where(p => (from is null || p.Date >= from) && (to is null || p.Date <= to)).ToList();
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GeneratePaymentsListPdf(items, company, from, to);
        return File(bytes, "application/pdf", "payments.pdf");
    }

    /// <summary>Same letterhead-building logic as PartnersController/ReportsController/
    /// InvoicesController's own copy — kept as its own copy here rather than shared, matching how
    /// these controllers already don't share a base class.</summary>
    private async Task<CompanyInfo> GetCompanyInfoAsync()
    {
        var settings = await _settingsService.ListAsync();
        string? Get(string key)
        {
            var value = settings.FirstOrDefault(s => s.Key == key)?.Value;
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        var (logoContent, _) = await _logoService.GetEffectiveLogoAsync();

        return new CompanyInfo(
            Get(Setting.Keys.MarketName) ?? "Green Market",
            Get(Setting.Keys.Address),
            Get(Setting.Keys.Phone),
            Get(Setting.Keys.RegistrationNumber),
            logoContent);
    }

    [HttpPost]
    [RequirePermission(PermissionKeys.PaymentsCreate)]
    public async Task<ActionResult<PaymentDto>> Create(CreatePaymentRequest request) =>
        Ok(await _paymentService.CreateAsync(request, CurrentUserId.Require(User)));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.PaymentsEdit)]
    public async Task<ActionResult<PaymentDto>> Update(int id, UpdatePaymentRequest request) =>
        Ok(await _paymentService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.PaymentsDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _paymentService.DeleteAsync(id);
        return NoContent();
    }
}
