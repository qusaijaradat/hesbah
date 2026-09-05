using System.Text.Json;
using GreenMarket.Api.Auth;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Common;

/// <summary>
/// Two related gaps closed here (requirement doc §2's permission model, and
/// User.MustChangePassword's own doc comment): a JWT is a self-contained, signed token that bakes
/// in every permission at login and stays valid for its full lifetime (JwtSettings.
/// AccessTokenMinutes) no matter what happens to the account afterward. Previously, deactivating a
/// user, changing their role's permissions, or flipping MustChangePassword had zero effect on a
/// token already issued until it naturally expired.
///
/// This re-checks the live user record on every authenticated request:
///   - a deactivated (or since-deleted) user is rejected immediately (401) instead of up to
///     AccessTokenMinutes later;
///   - a user whose MustChangePassword flag is set is blocked from every endpoint except the ones
///     that let them actually clear it (auth/login, auth/change-password) instead of that flag
///     being purely a frontend hint;
///   - a user whose role's permissions changed since the token was issued gets the CURRENT set
///     checked, not the stale claims baked into the token — a revoked permission also takes effect
///     on the very next request rather than up to an hour later.
///
/// One extra indexed-PK lookup plus a RolePermissions query per authenticated request — an
/// acceptable cost at this app's scale, and far simpler than a real revocation-list/refresh-token
/// scheme, which this deliberately is not (see the audit finding this closes: "JWT — بدون أي
/// إلغاء"). Registered between UseAuthentication and UseAuthorization in Program.cs so a rejection
/// here happens before the [RequirePermission] policy checks even run.
/// </summary>
public class LiveUserStateMiddleware
{
    private readonly RequestDelegate _next;

    public LiveUserStateMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var userIdClaim = context.User.FindFirst(ClaimTypesExtra.UserId)?.Value;
            if (!int.TryParse(userIdClaim, out var userId))
            {
                await RejectAsync(context, 401, "Invalid session — missing user identity in token.");
                return;
            }

            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId);
            if (user is null || !user.IsActive)
            {
                await RejectAsync(context, 401, "تم إلغاء تفعيل هذا الحساب — الرجاء تسجيل الدخول من جديد.");
                return;
            }

            // Only auth endpoints (login already anonymous; change-password is what actually
            // clears this flag) stay reachable while a password change is still owed.
            var path = context.Request.Path.Value ?? string.Empty;
            var isAuthEndpoint = path.StartsWith("/api/auth/", StringComparison.OrdinalIgnoreCase);
            if (user.MustChangePassword && !isAuthEndpoint)
            {
                await RejectAsync(context, 403, "يجب تغيير كلمة السر قبل المتابعة.");
                return;
            }

            var currentPermissions = await db.RolePermissions
                .Where(rp => rp.RoleId == user.RoleId)
                .Select(rp => rp.Permission.Key)
                .ToListAsync();
            var tokenPermissions = context.User.FindAll(ClaimTypesExtra.Permission).Select(c => c.Value).ToList();
            if (currentPermissions.Count != tokenPermissions.Count || !currentPermissions.ToHashSet().SetEquals(tokenPermissions))
            {
                await RejectAsync(context, 401, "تغيّرت صلاحياتك — الرجاء تسجيل الدخول من جديد.");
                return;
            }
        }

        await _next(context);
    }

    private static async Task RejectAsync(HttpContext context, int statusCode, string message)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(new { error = message }));
    }
}
