using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §3: unified farmers/merchants table + name-suggestion lookup. §6: account statements.</summary>
[ApiController]
[Authorize]
[Route("api/partners")]
public class PartnersController : ControllerBase
{
    private readonly IPartnerService _partnerService;
    private readonly IExportService _exportService;
    private readonly ISettingsService _settingsService;
    private readonly ICompanyLogoService _logoService;

    public PartnersController(IPartnerService partnerService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService)
    {
        _partnerService = partnerService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult> List(string? search, PartnerType? type, int page = 1, int pageSize = 25) =>
        Ok(await _partnerService.ListAsync(search, type, page, pageSize));

    [HttpGet("suggest")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<IReadOnlyList<PartnerSuggestionDto>>> Suggest([FromQuery] string? q = null, [FromQuery] string? types = null) =>
        Ok(await _partnerService.SuggestAsync(q, ParseTypes(types)));

    /// <summary>Parses a comma-separated list like "Farmer,Driver" from the query string into enum
    /// values, ignoring anything that doesn't match a known <see cref="PartnerType"/> name.</summary>
    private static IReadOnlyCollection<PartnerType>? ParseTypes(string? types)
    {
        if (string.IsNullOrWhiteSpace(types)) return null;
        var parsed = types.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(t => Enum.TryParse<PartnerType>(t, ignoreCase: true, out var value) ? value : (PartnerType?)null)
            .Where(v => v is not null)
            .Select(v => v!.Value)
            .ToList();
        return parsed.Count > 0 ? parsed : null;
    }

    /// <summary>"قيمة الدين" overview page: everyone with a non-zero balance, split into بائع/سائق/مشتري.
    /// Placed before {id:int} for the same reason "suggest" is — "debts-overview" would otherwise
    /// never match the int-constrained route anyway, but this keeps the literal routes grouped.</summary>
    [HttpGet("debts-overview")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<DebtsOverviewDto>> DebtsOverview() => Ok(await _partnerService.GetDebtsOverviewAsync());

    /// <summary>"قيمة الديون" print button — see ExportService.GenerateDebtsOverviewPdf's own doc
    /// comment. Same data as DebtsOverview() above, just rendered as one printable PDF.</summary>
    [HttpGet("debts-overview/print/pdf")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<IActionResult> DebtsOverviewPrintPdf()
    {
        var data = await _partnerService.GetDebtsOverviewAsync();
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateDebtsOverviewPdf(data, company);
        return File(bytes, "application/pdf", "debts-overview.pdf");
    }

    [HttpGet("{id:int}")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<PartnerDto>> Get(int id) => Ok(await _partnerService.GetAsync(id));

    [HttpPost]
    [RequirePermission(PermissionKeys.PartnersCreate)]
    public async Task<ActionResult<PartnerDto>> Create(CreatePartnerRequest request) => Ok(await _partnerService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.PartnersEdit)]
    public async Task<ActionResult<PartnerDto>> Update(int id, UpdatePartnerRequest request) => Ok(await _partnerService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.PartnersDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _partnerService.DeleteAsync(id);
        return NoContent();
    }

    [HttpGet("{id:int}/merchant-account")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<MerchantAccountDto>> MerchantAccount(int id) => Ok(await _partnerService.GetMerchantAccountAsync(id));

    [HttpGet("{id:int}/farmer-account")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<FarmerAccountDto>> FarmerAccount(int id) => Ok(await _partnerService.GetFarmerAccountAsync(id));

    /// <summary>"قيمة الديون" drill-down page (بائع/سائق side) — every item line off every one of this
    /// partner's own invoices, all-time, so the amount shown on the debts overview is traceable back
    /// to exactly which invoices/items/quantities/prices make it up.</summary>
    [HttpGet("{id:int}/farmer-invoice-detail")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<PartnerInvoiceDetailDto>> FarmerInvoiceDetail(int id) => Ok(await _partnerService.GetFarmerInvoiceDetailAsync(id));

    /// <summary>مشتري-side counterpart of FarmerInvoiceDetail above.</summary>
    [HttpGet("{id:int}/merchant-invoice-detail")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<PartnerInvoiceDetailDto>> MerchantInvoiceDetail(int id) => Ok(await _partnerService.GetMerchantInvoiceDetailAsync(id));

    /// <summary>Same letterhead-building logic as ReportsController/InvoicesController's own copy —
    /// kept as its own copy here rather than shared, matching how these controllers already don't
    /// share a base class.</summary>
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
}
