using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>Requirement doc §13 main table. Roles are editable, not hard-coded.</summary>
public class Role : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }

    public ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();
    public ICollection<User> Users { get; set; } = new List<User>();
}
