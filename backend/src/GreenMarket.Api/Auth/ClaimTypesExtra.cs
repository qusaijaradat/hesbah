namespace GreenMarket.Api.Auth;

/// <summary>Custom JWT claim types used alongside the standard ones (sub, name).</summary>
public static class ClaimTypesExtra
{
    public const string UserId = "gm_uid";
    public const string RoleName = "gm_role";

    /// <summary>One claim per granted permission key (requirement doc §2 screen/action-level permissions).</summary>
    public const string Permission = "gm_perm";
}
