namespace GreenMarket.Domain.Entities;

/// <summary>Join entity: which permissions a role grants. No AuditableEntity base — it's a pure link row.</summary>
public class RolePermission
{
    public int RoleId { get; set; }
    public Role Role { get; set; } = null!;

    public int PermissionId { get; set; }
    public Permission Permission { get; set; } = null!;
}
