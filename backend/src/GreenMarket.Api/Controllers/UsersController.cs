using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §2: user management (create/edit/enable/disable) and role listing.</summary>
[ApiController]
[Authorize]
[Route("api/users")]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;
    public UsersController(IUserService userService) => _userService = userService;

    [HttpGet]
    [RequirePermission(PermissionKeys.UsersManage)]
    public async Task<ActionResult<IReadOnlyList<UserDto>>> List() => Ok(await _userService.ListAsync());

    [HttpPost]
    [RequirePermission(PermissionKeys.UsersManage)]
    public async Task<ActionResult<UserDto>> Create(CreateUserRequest request) => Ok(await _userService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.UsersManage)]
    public async Task<ActionResult<UserDto>> Update(int id, UpdateUserRequest request) => Ok(await _userService.UpdateAsync(id, request));

    [HttpGet("roles")]
    [RequirePermission(PermissionKeys.UsersManage)]
    public async Task<ActionResult<IReadOnlyList<RoleDto>>> Roles() => Ok(await _userService.ListRolesAsync());
}
