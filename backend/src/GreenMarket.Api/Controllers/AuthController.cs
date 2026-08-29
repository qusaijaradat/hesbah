using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    public AuthController(IAuthService authService) => _authService = authService;

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request) =>
        Ok(await _authService.LoginAsync(request));

    /// <summary>Any logged-in user can change their own password — this is the path the forced
    /// "must change password" screen calls, and it's also there for a voluntary change any
    /// other time, not previously possible without going through an admin. AuthController has
    /// no class-level [Authorize] (Login must stay anonymous), so this needs its own.</summary>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        await _authService.ChangePasswordAsync(CurrentUserId.Require(User), request);
        return NoContent();
    }
}
