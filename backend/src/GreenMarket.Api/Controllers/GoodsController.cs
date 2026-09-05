using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>"بضاعة الباعة" goods-stock intake — see GoodsService/FarmerGoodsEntry.</summary>
[ApiController]
[Authorize]
[Route("api/goods")]
public class GoodsController : ControllerBase
{
    private readonly IGoodsService _goodsService;
    private readonly IExportService _exportService;
    private readonly ISettingsService _settingsService;
    private readonly ICompanyLogoService _logoService;

    public GoodsController(IGoodsService goodsService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService)
    {
        _goodsService = goodsService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
    }

    [HttpGet("farmer/{farmerId:int}")]
    [RequirePermission(PermissionKeys.FarmerGoodsView)]
    public async Task<ActionResult<FarmerGoodsStockDto>> GetForFarmer(int farmerId) =>
        Ok(await _goodsService.GetForFarmerAsync(farmerId));

    /// <summary>"بضاعة الباعة" print button — see ExportService.GenerateFarmerGoodsStockPdf's own
    /// doc comment.</summary>
    [HttpGet("farmer/{farmerId:int}/print/pdf")]
    [RequirePermission(PermissionKeys.FarmerGoodsView)]
    public async Task<IActionResult> PrintFarmerStockPdf(int farmerId)
    {
        var stock = await _goodsService.GetForFarmerAsync(farmerId);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateFarmerGoodsStockPdf(stock.FarmerName, stock.Stock, company);
        return File(bytes, "application/pdf", "farmer-stock.pdf");
    }

    /// <summary>Same letterhead-building logic as the other controllers' own copies — kept
    /// duplicated rather than shared, matching how these controllers already don't share a base class.</summary>
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

    /// <summary>"البضاعة المتوفرة حاليًا" summed across ALL farmers — shown at the bottom of
    /// "بضاعة الباعة" itself. See ReportsController.GoodsGlobalStock for the same data reached from
    /// "الإغلاق اليومي" under its own reports.view permission instead.</summary>
    [HttpGet("stock")]
    [RequirePermission(PermissionKeys.FarmerGoodsView)]
    public async Task<ActionResult<IReadOnlyList<GoodsStockRow>>> GetGlobalStock() =>
        Ok(await _goodsService.GetGlobalStockAsync());

    [HttpPost]
    [RequirePermission(PermissionKeys.FarmerGoodsCreate)]
    public async Task<ActionResult<GoodsEntryDto>> Create(CreateGoodsEntryRequest request) =>
        Ok(await _goodsService.CreateAsync(request, CurrentUserId.Require(User)));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.FarmerGoodsEdit)]
    public async Task<ActionResult<GoodsEntryDto>> Update(int id, UpdateGoodsEntryRequest request) =>
        Ok(await _goodsService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.FarmerGoodsDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _goodsService.DeleteAsync(id);
        return NoContent();
    }
}
