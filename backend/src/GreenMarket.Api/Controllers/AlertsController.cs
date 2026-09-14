using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// The top-of-page alerts banner — see AlertService for what earns a place on it and what
/// deliberately doesn't.
///
/// No [RequirePermission] on the action itself, on purpose: this endpoint spans two areas, and a
/// single blanket permission would either hide checks from someone allowed to see invoices or the
/// reverse. Instead the caller's own permission claims are handed to AlertVisibility, which decides
/// per kind — and an empty list comes back, never a 403, when they may be told none of it.
///
/// The same claims, the same rule, and the same answer as the morning push notification: see
/// AlertVisibility for why a person must be able to FIX a thing before being told it is wrong.
/// </summary>
[ApiController]
[Authorize]
[Route("api/alerts")]
public class AlertsController : ControllerBase
{
    private readonly IAlertService _alertService;

    public AlertsController(IAlertService alertService) => _alertService = alertService;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AlertDto>>> Get()
    {
        var permissions = User.FindAll(ClaimTypesExtra.Permission).Select(c => c.Value).ToHashSet();
        return Ok(await _alertService.GetAsync(permissions));
    }
}
