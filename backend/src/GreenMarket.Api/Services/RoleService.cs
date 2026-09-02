using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// Requirement doc §13/§2: roles are a fully editable table, not hard-coded — this closes the
/// gap where that was only true at the database level (editing a role's permission grants
/// required raw SQL) by giving the Users/Roles screen a real create/edit UI for it.
/// </summary>
public interface IRoleService
{
    Task<IReadOnlyList<RoleDto>> ListAsync();
    Task<IReadOnlyList<PermissionDto>> ListPermissionsAsync();
    Task<RoleDto> CreateAsync(CreateRoleRequest request);
    Task<RoleDto> UpdateAsync(int id, UpdateRoleRequest request);

    /// <summary>Only ever succeeds on a role with zero users currently assigned to it — see the
    /// implementation. Reassign or deactivate its users first.</summary>
    Task DeleteAsync(int id);
}

public class RoleService : IRoleService
{
    private readonly AppDbContext _db;
    public RoleService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<RoleDto>> ListAsync()
    {
        var roles = await _db.Roles.Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
            .OrderBy(r => r.Name).ToListAsync();
        return roles.Select(ToDto).ToList();
    }

    public async Task<IReadOnlyList<PermissionDto>> ListPermissionsAsync()
    {
        var permissions = await _db.Permissions.OrderBy(p => p.Key).ToListAsync();
        return permissions.Select(p => new PermissionDto(p.Id, p.Key, p.Description)).ToList();
    }

    public async Task<RoleDto> CreateAsync(CreateRoleRequest request)
    {
        var name = request.Name.Trim();
        if (string.IsNullOrWhiteSpace(name)) throw new ValidationAppException("Role name is required.");
        if (await _db.Roles.AnyAsync(r => r.Name == name))
            throw new ConflictAppException($"A role named '{name}' already exists.");

        var role = new Role { Name = name, Description = request.Description };
        _db.Roles.Add(role);
        await _db.SaveChangesAsync(); // need role.Id before adding RolePermission rows

        await ApplyPermissionGrantsAsync(role.Id, request.PermissionKeys);
        return await GetDtoAsync(role.Id);
    }

    public async Task<RoleDto> UpdateAsync(int id, UpdateRoleRequest request)
    {
        var role = await _db.Roles.FindAsync(id) ?? throw new NotFoundAppException("Role", id);

        var name = request.Name.Trim();
        if (string.IsNullOrWhiteSpace(name)) throw new ValidationAppException("Role name is required.");
        if (await _db.Roles.AnyAsync(r => r.Name == name && r.Id != id))
            throw new ConflictAppException($"A role named '{name}' already exists.");

        role.Name = name;
        role.Description = request.Description;
        await _db.SaveChangesAsync();

        await ApplyPermissionGrantsAsync(id, request.PermissionKeys);
        return await GetDtoAsync(id);
    }

    /// <summary>See the interface doc comment. A hard delete — unlike Partners/Employees this
    /// isn't a soft-delete-and-hide, since once no user is left pointing at this RoleId, nothing
    /// in the system will ever reference it again; RolePermission rows for it cascade-delete
    /// automatically (see RolePermissionConfiguration).</summary>
    public async Task DeleteAsync(int id)
    {
        var role = await _db.Roles.FindAsync(id) ?? throw new NotFoundAppException("Role", id);

        var userCount = await _db.Users.CountAsync(u => u.RoleId == id);
        if (userCount > 0)
            throw new ConflictAppException($"لا يمكن حذف هذا الدور لوجود {userCount} مستخدم(ين) مرتبطين به — غيّر دورهم أولًا.");

        _db.Roles.Remove(role);
        await _db.SaveChangesAsync();
    }

    /// <summary>Reconciles a role's RolePermission rows to exactly match the requested key set —
    /// removes grants no longer wanted, adds newly-checked ones, leaves the rest untouched.
    /// Unknown keys (typos, a permission that no longer exists) are silently ignored rather than
    /// failing the whole save, since the checklist UI can only ever send keys it was shown.</summary>
    private async Task ApplyPermissionGrantsAsync(int roleId, IReadOnlyList<string> permissionKeys)
    {
        var requested = permissionKeys?.ToHashSet() ?? new HashSet<string>();
        var permissionsByKey = await _db.Permissions.ToDictionaryAsync(p => p.Key);
        var keyById = permissionsByKey.Values.ToDictionary(p => p.Id, p => p.Key);
        var existingGrants = await _db.RolePermissions.Where(rp => rp.RoleId == roleId).ToListAsync();

        var toRemove = existingGrants.Where(g => !requested.Contains(keyById.GetValueOrDefault(g.PermissionId, ""))).ToList();
        if (toRemove.Count > 0) _db.RolePermissions.RemoveRange(toRemove);

        var existingKeys = existingGrants.Select(g => keyById.GetValueOrDefault(g.PermissionId, "")).ToHashSet();
        foreach (var key in requested)
        {
            if (existingKeys.Contains(key)) continue;
            if (!permissionsByKey.TryGetValue(key, out var permission)) continue;
            _db.RolePermissions.Add(new RolePermission { RoleId = roleId, PermissionId = permission.Id });
        }

        await _db.SaveChangesAsync();
    }

    private async Task<RoleDto> GetDtoAsync(int roleId)
    {
        var role = await _db.Roles.Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission)
            .SingleAsync(r => r.Id == roleId);
        return ToDto(role);
    }

    private static RoleDto ToDto(Role r) =>
        new(r.Id, r.Name, r.Description, r.RolePermissions.Select(rp => rp.Permission.Key).ToList());
}
