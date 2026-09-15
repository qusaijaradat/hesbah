using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
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
    private readonly ISessionService _sessions;

    public UsersController(IUserService userService, ISessionService sessions)
    {
        _userService = userService;
        _sessions = sessions;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.UsersView)]
    public async Task<ActionResult<IReadOnlyList<UserDto>>> List() => Ok(await _userService.ListAsync());

    [HttpGet("{id:int}")]
    [RequirePermission(PermissionKeys.UsersView)]
    public async Task<ActionResult<UserDto>> Get(int id) => Ok(await _userService.GetAsync(id));

    [HttpPost]
    [RequirePermission(PermissionKeys.UsersCreate)]
    public async Task<ActionResult<UserDto>> Create(CreateUserRequest request) => Ok(await _userService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.UsersEdit)]
    public async Task<ActionResult<UserDto>> Update(int id, UpdateUserRequest request) => Ok(await _userService.UpdateAsync(id, request));

    // Feeds the Users page's role-assignment dropdown — gated by UsersView (not RolesView) since
    // it's used purely to label/pick a role while managing users, not to manage roles themselves.
    [HttpGet("roles")]
    [RequirePermission(PermissionKeys.UsersView)]
    public async Task<ActionResult<IReadOnlyList<RoleDto>>> Roles() => Ok(await _userService.ListRolesAsync());

    /// <summary>
    /// Where this person is signed in, and since when.
    ///
    /// Accounts here stay signed in until somebody ends the session, which is only a safe way to
    /// run a market if somebody can actually SEE the list and end a line on it. That is what these
    /// three endpoints are, and why users.sessions is its own permission rather than part of
    /// UsersEdit — it is the switch that puts a person out, not a switch that fixes a typo.
    /// </summary>
    [HttpGet("{id:int}/sessions")]
    [RequirePermission(PermissionKeys.UsersSessions)]
    public async Task<ActionResult<IReadOnlyList<SessionDto>>> Sessions(int id, CancellationToken ct) =>
        Ok(await _sessions.ListForUserAsync(id, ct));

    /// <summary>Ends one device. It stops on its very next request — see LiveUserStateMiddleware.</summary>
    [HttpDelete("sessions/{sessionId:int}")]
    [RequirePermission(PermissionKeys.UsersSessions)]
    public async Task<IActionResult> EndSession(int sessionId, CancellationToken ct)
    {
        await _sessions.EndByIdAsync(sessionId, SessionRevokeReason.EndedByAdmin, CurrentUserId.Require(User), ct);
        return NoContent();
    }

    /// <summary>Ends every device this person is signed in on — the "he left today" button.</summary>
    [HttpDelete("{id:int}/sessions")]
    [RequirePermission(PermissionKeys.UsersSessions)]
    public async Task<ActionResult<int>> EndAllSessions(int id, CancellationToken ct) =>
        Ok(await _sessions.EndAllForUserAsync(id, SessionRevokeReason.EndedByAdmin, CurrentUserId.Require(User), ct));
}
