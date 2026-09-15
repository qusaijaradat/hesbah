using System.Security.Claims;
using GreenMarket.Api.Auth;
using GreenMarket.Api.Common;

namespace GreenMarket.Api.Controllers;

/// <summary>Small shared helper so every controller extracts the acting user's id from JWT claims the same way.</summary>
public static class CurrentUserId
{
    public static int Require(ClaimsPrincipal user)
    {
        var value = user.FindFirst(ClaimTypesExtra.UserId)?.Value;
        if (!int.TryParse(value, out var id))
            throw new UnauthorizedAppException("Missing or invalid user identity in token.");
        return id;
    }

    /// <summary>
    /// The caller's id when there is one, null when the request is anonymous — for the handful of
    /// endpoints that accept both. Sign-out is the case: somebody whose access token has already
    /// lapsed still deserves to have their session actually ended, and the row records who did it
    /// when that is knowable.
    /// </summary>
    public static int? Optional(ClaimsPrincipal user) =>
        int.TryParse(user.FindFirst(ClaimTypesExtra.UserId)?.Value, out var id) ? id : null;
}
