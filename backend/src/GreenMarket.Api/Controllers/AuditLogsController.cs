using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §14, read side: view of the edit-history log that
/// AuditSaveChangesInterceptor has been writing since the initial build.</summary>
[ApiController]
[Authorize]
[Route("api/audit-logs")]
public class AuditLogsController : ControllerBase
{
    private readonly IAuditLogService _auditLogService;
    public AuditLogsController(IAuditLogService auditLogService) => _auditLogService = auditLogService;

    [HttpGet]
    [RequirePermission(PermissionKeys.AuditView)]
    public async Task<ActionResult> List([FromQuery] AuditLogFilterRequest filter) =>
        Ok(await _auditLogService.ListAsync(filter));

    [HttpGet("entity-names")]
    [RequirePermission(PermissionKeys.AuditView)]
    public async Task<ActionResult<IReadOnlyList<string>>> EntityNames() =>
        Ok(await _auditLogService.ListEntityNamesAsync());
}
