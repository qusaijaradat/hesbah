using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// Requirement doc §13/§2: roles are a fully editable table — create/edit here, gated by the
/// same permission as user management since the two screens live together in the UI.
/// </summary>
[ApiController]
[Authorize]
[Route("api/roles")]
public class RolesController : ControllerBase
{
    private readonly IRoleService _roleService;
    public RolesController(IRoleService roleService) => _roleService = roleService;

    [HttpGet]
    [RequirePermission(PermissionKeys.RolesView)]
    public async Task<ActionResult<IReadOnlyList<RoleDto>>> List() => Ok(await _roleService.ListAsync());

    [HttpGet("permissions")]
    [RequirePermission(PermissionKeys.RolesView)]
    public async Task<ActionResult<IReadOnlyList<PermissionDto>>> Permissions() => Ok(await _roleService.ListPermissionsAsync());

    [HttpPost]
    [RequirePermission(PermissionKeys.RolesCreate)]
    public async Task<ActionResult<RoleDto>> Create(CreateRoleRequest request) => Ok(await _roleService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.RolesEdit)]
    public async Task<ActionResult<RoleDto>> Update(int id, UpdateRoleRequest request) => Ok(await _roleService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.RolesDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _roleService.DeleteAsync(id);
        return NoContent();
    }
}
