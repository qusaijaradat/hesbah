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
/// reverse. Instead each alert kind is gated individually below, from the caller's own permission
/// claims, so the banner shows exactly the subset of things that person could have navigated to
/// anyway — and an empty list, never a 403, when they can see none of it.
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
        return Ok(await _alertService.GetAsync(
            includeChecks: permissions.Contains(PermissionKeys.PaymentsView),
            includeInvoices: permissions.Contains(PermissionKeys.InvoicesView)));
    }
}
