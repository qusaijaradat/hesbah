using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One granular action/screen permission (requirement doc §2: "permissions are at the
/// level of operations and screens"). Keys come from <see cref="GreenMarket.Domain.Enums.PermissionKeys"/>.
/// </summary>
public class Permission : AuditableEntity
{
    public string Key { get; set; } = string.Empty;
    public string? Description { get; set; }

    public ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();
}
