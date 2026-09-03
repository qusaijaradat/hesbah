using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
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
    public GoodsController(IGoodsService goodsService) => _goodsService = goodsService;

    [HttpGet("farmer/{farmerId:int}")]
    [RequirePermission(PermissionKeys.FarmerGoodsView)]
    public async Task<ActionResult<FarmerGoodsStockDto>> GetForFarmer(int farmerId) =>
        Ok(await _goodsService.GetForFarmerAsync(farmerId));

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
