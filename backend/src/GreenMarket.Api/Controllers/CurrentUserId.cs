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
}
