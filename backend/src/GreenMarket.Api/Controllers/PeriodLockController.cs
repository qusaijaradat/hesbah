using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// Closing a settled month, and opening one back up — see PeriodLockService.
///
/// Reading the status needs no special permission: everyone who enters an invoice benefits from
/// knowing where the line is, and being refused with no way to see why is how people conclude the
/// system is broken. Moving the line is another matter, and belongs to whoever settles the month.
/// </summary>
[ApiController]
[Authorize]
[Route("api/period-lock")]
public class PeriodLockController : ControllerBase
{
    private readonly IPeriodLockService _service;

    public PeriodLockController(IPeriodLockService service) => _service = service;

    [HttpGet]
    public async Task<ActionResult<PeriodLockStatusDto>> Get() => Ok(await _service.GetStatusAsync());

    [HttpPost("close")]
    [RequirePermission(PermissionKeys.PeriodLock)]
    public async Task<ActionResult<PeriodLockStatusDto>> Close([FromBody] ClosePeriodRequest request) =>
        Ok(await _service.CloseAsync(request.Month, CurrentUserId.Optional(User)));

    [HttpPost("reopen")]
    [RequirePermission(PermissionKeys.PeriodLock)]
    public async Task<ActionResult<PeriodLockStatusDto>> Reopen() =>
        Ok(await _service.ReopenAsync(CurrentUserId.Optional(User)));
}
