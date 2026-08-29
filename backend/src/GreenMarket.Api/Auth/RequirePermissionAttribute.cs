using Microsoft.AspNetCore.Authorization;

namespace GreenMarket.Api.Auth;

/// <summary>
/// Screen/action-level permission gate (requirement doc §2: "permissions are at the
/// level of operations and screens"). Usage: [RequirePermission(PermissionKeys.InvoicesCreate)].
/// Backed by a policy-per-permission-key registered in Program.cs so ASP.NET Core's
/// normal [Authorize] pipeline (and Swagger's auth UI) handles it uniformly.
/// </summary>
public class RequirePermissionAttribute : AuthorizeAttribute
{
    public RequirePermissionAttribute(string permissionKey) : base(policy: permissionKey)
    {
    }
}

public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        if (context.User.HasClaim(ClaimTypesExtra.Permission, requirement.PermissionKey))
        {
            context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}

public class PermissionRequirement : IAuthorizationRequirement
{
    public string PermissionKey { get; }
    public PermissionRequirement(string permissionKey) => PermissionKey = permissionKey;
}
