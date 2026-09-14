using GreenMarket.Api.Auth;
using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// "المخالات" — its own section, separate from the crates screen.
///
/// Its own permissions (sacks.*), not the crates'. The market wanted an account that records
/// sacks and sees nothing else; sharing boxes.* would have quietly given that account the crates
/// screen as well.
/// </summary>
[ApiController]
[Route("api/sacks")]
[Authorize]
public class SacksController : ControllerBase
{
    private readonly ISackService _sacks;
    private readonly IExportService _export;
    private readonly ISettingsService _settings;
    private readonly ICompanyLogoService _logo;

    public SacksController(ISackService sacks, IExportService export, ISettingsService settings, ICompanyLogoService logo)
    {
        _sacks = sacks;
        _export = export;
        _settings = settings;
        _logo = logo;
    }

    // ---------------------------------------------------------------- kinds

    [HttpGet("kinds")]
    [RequirePermission(PermissionKeys.SacksView)]
    public async Task<ActionResult<IReadOnlyList<SackKindDto>>> Kinds([FromQuery] bool includeInactive = false) =>
        Ok(await _sacks.ListKindsAsync(includeInactive));

    /// <summary>Creating a kind is part of using the picker, so it needs no more rights than recording a movement.</summary>
    [HttpPost("kinds")]
    [RequirePermission(PermissionKeys.SacksCreate)]
    public async Task<ActionResult<SackKindDto>> CreateKind(CreateSackKindRequest request) =>
        Ok(await _sacks.CreateKindAsync(request));

    [HttpPut("kinds/{id:int}")]
    [RequirePermission(PermissionKeys.SacksCreate)]
    public async Task<ActionResult<SackKindDto>> UpdateKind(int id, UpdateSackKindRequest request) =>
        Ok(await _sacks.UpdateKindAsync(id, request));

    // ---------------------------------------------------------------- movements

    /// <summary>"سحب" — sacks going out to a buyer, several kinds in one event.</summary>
    [HttpPost("withdrawals")]
    [RequirePermission(PermissionKeys.SacksCreate)]
    public async Task<ActionResult<IReadOnlyList<SackMovementDto>>> Withdraw(CreateSackMovementRequest request) =>
        Ok(await _sacks.CreateMovementAsync(ContainerDirection.Out, request));

    /// <summary>"ارتجاع" — sacks coming back, several kinds in one event.</summary>
    [HttpPost("returns")]
    [RequirePermission(PermissionKeys.SacksCreate)]
    public async Task<ActionResult<IReadOnlyList<SackMovementDto>>> Return(CreateSackMovementRequest request) =>
        Ok(await _sacks.CreateMovementAsync(ContainerDirection.In, request));

    [HttpDelete("movements/{movementId:int}")]
    [RequirePermission(PermissionKeys.SacksDelete)]
    public async Task<IActionResult> DeleteMovement(int movementId)
    {
        await _sacks.DeleteMovementAsync(movementId);
        return NoContent();
    }

    // ---------------------------------------------------------------- reports

    [HttpGet("overview")]
    [RequirePermission(PermissionKeys.SacksView)]
    public async Task<ActionResult<SacksOverviewDto>> Overview(
        [FromQuery] DateTimeOffset? dateFrom, [FromQuery] DateTimeOffset? dateTo, [FromQuery] int? partnerId) =>
        Ok(await _sacks.GetOverviewAsync(dateFrom, dateTo, partnerId));

    [HttpGet("overview/print/pdf")]
    [RequirePermission(PermissionKeys.SacksView)]
    public async Task<IActionResult> PrintOverview(
        [FromQuery] DateTimeOffset? dateFrom, [FromQuery] DateTimeOffset? dateTo, [FromQuery] int? partnerId)
    {
        var data = await _sacks.GetOverviewAsync(dateFrom, dateTo, partnerId);
        var company = await CompanyAsync();
        return File(_export.GenerateSacksOverviewPdf(data, company), "application/pdf", "sacks.pdf");
    }

    /// <summary>The printed header, built from Settings the same way every other print does it.</summary>
    private async Task<CompanyInfo> CompanyAsync()
    {
        var settings = await _settings.ListAsync();
        string? Get(string key)
        {
            var value = settings.FirstOrDefault(x => x.Key == key)?.Value;
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        var (logoContent, _) = await _logo.GetEffectiveLogoAsync();
        return new CompanyInfo(
            Get(Setting.Keys.MarketName) ?? "Green Market",
            Get(Setting.Keys.Address),
            Get(Setting.Keys.Phone),
            Get(Setting.Keys.RegistrationNumber),
            logoContent);
    }
}
