using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    /// <summary>
    /// The refresh token's cookie.
    ///
    /// httpOnly, so no script on this page can read it — which is the whole reason it is a cookie
    /// and not a field in the login response. The access token still lives in browser storage and
    /// still lasts hours; this one lasts until somebody ends the session, and a value with that
    /// much reach must not be reachable by a stray &lt;script&gt;.
    ///
    /// Same-site strict and same-origin: in production nginx serves the app and proxies /api on one
    /// host (see frontend/nginx.conf), so this is a first-party cookie — which is also why it works
    /// on an iPhone, where Safari would refuse a cross-site one.
    ///
    /// Scoped to /api/auth because those three endpoints are the only ones that ever read it. Every
    /// other request in the app then carries no credential beyond its bearer token.
    /// </summary>
    private const string RefreshCookie = "gm_refresh";

    private readonly IAuthService _authService;
    private readonly ISessionService _sessions;
    private readonly AppDbContext _db;
    private readonly IJwtTokenGenerator _jwt;

    public AuthController(
        IAuthService authService, ISessionService sessions, AppDbContext db, IJwtTokenGenerator jwt)
    {
        _authService = authService;
        _sessions = sessions;
        _db = db;
        _jwt = jwt;
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request)
    {
        var (response, refreshToken) = await _authService.LoginAsync(request, UserAgent);
        SetRefreshCookie(refreshToken);
        return Ok(response);
    }

    /// <summary>
    /// Trades the refresh cookie for a fresh access token, and a fresh cookie with it.
    ///
    /// Anonymous on purpose: this is the endpoint called precisely BECAUSE the access token is no
    /// longer accepted, so requiring one would make it unreachable at the only moment it matters.
    /// The cookie is the credential, and it is checked against the session row.
    /// </summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Refresh()
    {
        var presented = Request.Cookies[RefreshCookie];
        if (string.IsNullOrWhiteSpace(presented)) return Unauthorized(new { error = "انتهت الجلسة." });

        var rotated = await _sessions.RotateAsync(presented);
        if (rotated is null)
        {
            // Not this session's token, the session is over, or a retired token came back — the
            // last of which has already killed the session inside RotateAsync. Nothing here can
            // tell those apart, and nothing should say which it was.
            ClearRefreshCookie();
            return Unauthorized(new { error = "انتهت الجلسة — سجّل دخول من جديد." });
        }

        var (session, newToken) = rotated.Value;
        var user = await _db.Users.Include(u => u.Role).SingleOrDefaultAsync(u => u.Id == session.UserId);
        if (user is null || !user.IsActive)
        {
            await _sessions.EndByIdAsync(session.Id, SessionRevokeReason.EndedByAdmin, null);
            ClearRefreshCookie();
            return Unauthorized(new { error = "تم إلغاء تفعيل هذا الحساب." });
        }

        SetRefreshCookie(newToken);
        var (token, expiresAt) = await _jwt.GenerateAsync(user, session.Id);
        var permissions = await _db.RolePermissions
            .Where(rp => rp.RoleId == user.RoleId)
            .Select(rp => rp.Permission.Key)
            .ToListAsync();
        var dto = new UserDto(user.Id, user.FullName, user.Username, user.Role.Name, user.IsActive, permissions);
        return Ok(new LoginResponse(token, expiresAt, dto, user.MustChangePassword));
    }

    /// <summary>
    /// Ends THIS device's session. Anonymous for the same reason refresh is: somebody signing out
    /// after their access token lapsed still deserves to have the session actually ended, rather
    /// than left live on a device they believe they have left.
    /// </summary>
    [HttpPost("logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        var presented = Request.Cookies[RefreshCookie];
        if (!string.IsNullOrWhiteSpace(presented))
            await _sessions.EndAsync(presented, SessionRevokeReason.SignedOut, CurrentUserId.Optional(User));
        ClearRefreshCookie();
        return NoContent();
    }

    /// <summary>My own devices. No permission: everyone may see where their own account is signed
    /// in, and end any of it. users.sessions is for doing that to SOMEBODY ELSE.</summary>
    [HttpGet("sessions")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<SessionDto>>> MySessions(CancellationToken ct) =>
        Ok(await _sessions.ListForUserAsync(CurrentUserId.Require(User), ct));

    [HttpDelete("sessions/{id:int}")]
    [Authorize]
    public async Task<IActionResult> EndMySession(int id, CancellationToken ct)
    {
        var userId = CurrentUserId.Require(User);
        // Scoped to the caller's own sessions — an id from somewhere else must not end a stranger's
        // device just because this endpoint needs no permission.
        var mine = await _db.UserSessions.AnyAsync(s => s.Id == id && s.UserId == userId, ct);
        if (!mine) return NotFound();
        await _sessions.EndByIdAsync(id, SessionRevokeReason.SignedOut, userId, ct);
        return NoContent();
    }

    private string? UserAgent => Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null;

    private void SetRefreshCookie(string token) =>
        Response.Cookies.Append(RefreshCookie, token, CookieOptions(
            // Far future, because the SERVER decides when this session ends, not the browser. A
            // cookie that expired on its own would sign somebody out on a date nobody chose.
            DateTimeOffset.UtcNow.AddYears(5)));

    private void ClearRefreshCookie() =>
        Response.Cookies.Append(RefreshCookie, "", CookieOptions(DateTimeOffset.UnixEpoch));

    private CookieOptions CookieOptions(DateTimeOffset expires) => new()
    {
        HttpOnly = true,
        // Only where there IS https. The deployed app is https-only so this is always on there;
        // hardcoding it would mean the cookie is silently never set in local development, and the
        // first anybody knows of it is being signed out on every reload.
        Secure = Request.IsHttps,
        SameSite = SameSiteMode.Strict,
        Path = "/api/auth",
        Expires = expires
    };

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
