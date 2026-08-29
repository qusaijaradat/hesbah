using GreenMarket.Infrastructure.Persistence;

namespace GreenMarket.Api.Auth;

/// <summary>
/// Reads "who is making this request" from the JWT claims on HttpContext, implementing
/// the Infrastructure-layer abstraction so AppDbContext can stamp CreatedByUserId /
/// UpdatedByUserId without depending on ASP.NET Core itself.
/// </summary>
public class CurrentUserAccessor : ICurrentUserAccessor
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CurrentUserAccessor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public int? UserId
    {
        get
        {
            var value = _httpContextAccessor.HttpContext?.User?.FindFirst(ClaimTypesExtra.UserId)?.Value;
            return int.TryParse(value, out var id) ? id : null;
        }
    }
}
