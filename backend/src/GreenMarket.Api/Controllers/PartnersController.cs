using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
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
    private readonly IContainerService _containerService;
    // Only for the seller statement's foot, which deducts what the same man owes as a buyer.
    private readonly IPaymentService _paymentService;

    public PartnersController(IPartnerService partnerService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService, IContainerService containerService, IPaymentService paymentService)
    {
        _partnerService = partnerService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
        _containerService = containerService;
        _paymentService = paymentService;
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

    /// <summary>"صناديق مطلوبة من المشتري" (explicit request) — the merchant account page's own
    /// GetMerchantAccountAsync call already returns the running given/returned/remaining balance;
    /// this is just the history list on its own, for a dedicated "سجل الإرجاع" view if ever needed.
    /// Gated by BoxesView, separate from PartnersView, so a role can be handed crate-tracking
    /// without also seeing full partner records, or vice versa.</summary>
    /// <summary>"تسوية/تعويض" on a seller's or driver's account — see
    /// PartnerService.CreateAdjustmentAsync. Its own permission, not PartnersEdit: this moves a
    /// real balance on a typed reason alone.</summary>
    [HttpPost("{id:int}/adjustments")]
    [RequirePermission(PermissionKeys.PartnersAdjust)]
    public async Task<ActionResult<AdjustmentDto>> CreateAdjustment(int id, CreateAdjustmentRequest request) =>
        Ok(await _partnerService.CreateAdjustmentAsync(id, request));

    /// <summary>"الصناديق والمخالات" for one person — a balance per kind plus the movements
    /// behind it. Works for a buyer, a seller or a driver alike; see IContainerService.</summary>
    /// <summary>"مين ماسك صناديقي" across everyone — see IContainerService.GetHoldersAsync.</summary>
    [HttpGet("containers/holders")]
    [RequirePermission(PermissionKeys.BoxesView)]
    public async Task<ActionResult<IReadOnlyList<ContainerHolderDto>>> ContainerHolders() =>
        Ok(await _containerService.GetHoldersAsync());

    [HttpGet("{id:int}/containers")]
    [RequirePermission(PermissionKeys.BoxesView)]
    public async Task<ActionResult<PartnerContainersDto>> Containers(int id) =>
        Ok(await _containerService.GetForPartnerAsync(id));

    [HttpPost("{id:int}/containers")]
    [RequirePermission(PermissionKeys.BoxesCreate)]
    public async Task<ActionResult<ContainerMovementDto>> CreateContainerMovement(int id, CreateContainerMovementRequest request) =>
        Ok(await _containerService.CreateAsync(id, request, CurrentUserId.Require(User)));

    /// <summary>Corrects a movement in place. Its own permission — fixing yesterday's count is a
    /// different trust from writing today's — and fully audited, which is what makes it safe.</summary>
    [HttpPut("containers/{movementId:int}")]
    [RequirePermission(PermissionKeys.BoxesEdit)]
    public async Task<ActionResult<ContainerMovementDto>> UpdateContainerMovement(int movementId, UpdateContainerMovementRequest request) =>
        Ok(await _containerService.UpdateAsync(movementId, request));

    [HttpDelete("containers/{movementId:int}")]
    [RequirePermission(PermissionKeys.BoxesDelete)]
    public async Task<IActionResult> DeleteContainerMovement(int movementId)
    {
        await _containerService.DeleteAsync(movementId);
        return NoContent();
    }

    /// <summary>"كشف حساب" print button on the مشتري account page — see
    /// ExportService.GenerateAccountStatementPdf's own doc comment.
    ///
    /// Both dates are optional and independent: neither prints the whole account exactly as
    /// before, either one narrows it to a period with a brought-forward opening line.</summary>
    [HttpGet("{id:int}/merchant-account/print/pdf")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<IActionResult> MerchantAccountPrintPdf(int id, [FromQuery] DateTimeOffset? dateFrom, [FromQuery] DateTimeOffset? dateTo)
    {
        var account = await _partnerService.GetMerchantAccountAsync(id, dateFrom, dateTo);
        // The goods behind the figures, over the same window — which day, which item, at what
        // price. That is what the conversation at the counter is about; the totals above it are
        // only ever the summary of it.
        var detail = await _partnerService.GetStatementDetailAsync(id, buyerSide: true, dateFrom, dateTo);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateAccountStatementPdf(account.Name, "كشف حساب مشتري", account.Statement, account.Remaining, company, dateFrom, dateTo, detail,
            openingBalanceElsewhere: account.OpeningBalanceElsewhere);
        return File(bytes, "application/pdf", "account-statement.pdf");
    }

    [HttpGet("{id:int}/farmer-account")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<FarmerAccountDto>> FarmerAccount(int id) => Ok(await _partnerService.GetFarmerAccountAsync(id));

    /// <summary>"كشف حساب" print button on the بائع/سائق account page — title reflects this
    /// person's ACTUAL type (a Driver never has a farmer side and vice versa), same convention as
    /// FarmerAccountPage.tsx's own roleLabel.</summary>
    [HttpGet("{id:int}/farmer-account/print/pdf")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<IActionResult> FarmerAccountPrintPdf(int id, [FromQuery] DateTimeOffset? dateFrom, [FromQuery] DateTimeOffset? dateTo)
    {
        var account = await _partnerService.GetFarmerAccountAsync(id, dateFrom, dateTo);
        var roleLabel = PartnerRoles.Has(account.Type, PartnerType.Driver) && !PartnerRoles.Has(account.Type, PartnerType.Farmer) ? "سائق" : "بائع";
        // What he sold, item by item, AND — for anyone who also drives — the sellers he carried
        // for with the haulage and the crate money on each. Both sections print only when they
        // have rows, so a plain seller and a plain driver each get theirs and not the other's.
        var detail = await _partnerService.GetStatementDetailAsync(id, buyerSide: false, dateFrom, dateTo);
        // And what the same man owes as a buyer, deducted at the foot — through the one method that
        // decides it, which كشف بائع on the print screen also calls. Two sheets for the same man on
        // the same day ending on different figures is the whole reason this is not computed here.
        var buyerOwes = await _paymentService.GetBuyerBalanceForSellerSheetAsync(id);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateAccountStatementPdf(account.Name, $"كشف حساب {roleLabel}", account.Statement, account.Remaining, company, dateFrom, dateTo, detail, buyerOwes);
        return File(bytes, "application/pdf", "account-statement.pdf");
    }

    /// <summary>"قيمة الديون" drill-down page (بائع/سائق side) — every item line off every one of this
    /// partner's own invoices, all-time, so the amount shown on the debts overview is traceable back
    /// to exactly which invoices/items/quantities/prices make it up.</summary>
    [HttpGet("{id:int}/farmer-invoice-detail")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<PartnerInvoiceDetailDto>> FarmerInvoiceDetail(int id) => Ok(await _partnerService.GetFarmerInvoiceDetailAsync(id));

    /// <summary>"قيمة الديون" drill-down print button — see ExportService.GenerateInvoiceDetailPdf's
    /// own doc comment.</summary>
    [HttpGet("{id:int}/farmer-invoice-detail/print/pdf")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<IActionResult> FarmerInvoiceDetailPrintPdf(int id)
    {
        var detail = await _partnerService.GetFarmerInvoiceDetailAsync(id);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateInvoiceDetailPdf(detail.PartnerName, "تفاصيل فواتير بائع/سائق", detail.Lines, company);
        return File(bytes, "application/pdf", "invoice-detail.pdf");
    }

    /// <summary>مشتري-side counterpart of FarmerInvoiceDetail above.</summary>
    [HttpGet("{id:int}/merchant-invoice-detail")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<ActionResult<PartnerInvoiceDetailDto>> MerchantInvoiceDetail(int id) => Ok(await _partnerService.GetMerchantInvoiceDetailAsync(id));

    /// <summary>مشتري-side counterpart of FarmerInvoiceDetailPrintPdf above.</summary>
    [HttpGet("{id:int}/merchant-invoice-detail/print/pdf")]
    [RequirePermission(PermissionKeys.PartnersView)]
    public async Task<IActionResult> MerchantInvoiceDetailPrintPdf(int id)
    {
        var detail = await _partnerService.GetMerchantInvoiceDetailAsync(id);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateInvoiceDetailPdf(detail.PartnerName, "تفاصيل فواتير مشتري", detail.Lines, company);
        return File(bytes, "application/pdf", "invoice-detail.pdf");
    }

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
