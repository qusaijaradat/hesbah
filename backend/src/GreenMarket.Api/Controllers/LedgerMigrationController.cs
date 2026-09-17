using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// The one-time "move the produce money onto the drivers" migration — see LedgerMigrationService
/// for what it does and why it records every row it touches.
///
/// Three endpoints and nothing else: look at it, do it, undo it. No filters, no parameters — the
/// move is defined entirely by the ledger's own contents and the "سائق المصلحة" setting, so there
/// is nothing for a caller to get wrong except whether to press the button.
/// </summary>
[ApiController]
[Authorize]
[Route("api/ledger-migration")]
public class LedgerMigrationController : ControllerBase
{
    private readonly ILedgerMigrationService _service;

    public LedgerMigrationController(ILedgerMigrationService service) => _service = service;

    /// <summary>Reads and computes; writes nothing. Safe to open as often as you like.</summary>
    [HttpGet("preview")]
    [RequirePermission(PermissionKeys.LedgerMigrate)]
    public async Task<ActionResult<LedgerMigrationPreviewDto>> Preview() => Ok(await _service.PreviewAsync());

    [HttpPost("run")]
    [RequirePermission(PermissionKeys.LedgerMigrate)]
    public async Task<ActionResult<LedgerMigrationResultDto>> Run() =>
        Ok(await _service.RunAsync(CurrentUserId.Optional(User)));

    [HttpPost("undo")]
    [RequirePermission(PermissionKeys.LedgerMigrate)]
    public async Task<ActionResult<LedgerMigrationResultDto>> Undo() =>
        Ok(await _service.UndoAsync(CurrentUserId.Optional(User)));
}
