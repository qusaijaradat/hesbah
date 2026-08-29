using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §5: the commission rate (and other settings) must be configurable, not hard-coded.</summary>
[ApiController]
[Authorize]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly ISettingsService _settingsService;
    public SettingsController(ISettingsService settingsService) => _settingsService = settingsService;

    [HttpGet]
    [RequirePermission(PermissionKeys.SettingsManage)]
    public async Task<ActionResult<IReadOnlyList<SettingDto>>> List() => Ok(await _settingsService.ListAsync());

    [HttpPut("{key}")]
    [RequirePermission(PermissionKeys.SettingsManage)]
    public async Task<ActionResult<SettingDto>> Update(string key, UpdateSettingRequest request) =>
        Ok(await _settingsService.UpdateAsync(key, request.Value, CurrentUserId.Require(User)));
}
