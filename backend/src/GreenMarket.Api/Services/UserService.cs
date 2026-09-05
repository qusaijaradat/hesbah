using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using GreenMarket.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §2: "user management: creating, editing, activating/deactivating accounts."</summary>
public interface IUserService
{
    Task<IReadOnlyList<UserDto>> ListAsync();

    /// <summary>Single-user lookup for the edit form — previously the edit screen had to fetch and
    /// filter the whole list to find one row instead of asking for it directly.</summary>
    Task<UserDto> GetAsync(int id);
    Task<UserDto> CreateAsync(CreateUserRequest request);
    Task<UserDto> UpdateAsync(int id, UpdateUserRequest request);
    Task<IReadOnlyList<RoleDto>> ListRolesAsync();
}

public class UserService : IUserService
{
    private readonly AppDbContext _db;

    public UserService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<UserDto>> ListAsync()
    {
        var users = await _db.Users.Include(u => u.Role).OrderBy(u => u.FullName).ToListAsync();
        var permsByRole = await _db.RolePermissions.Include(rp => rp.Permission)
            .GroupBy(rp => rp.RoleId)
            .ToDictionaryAsync(g => g.Key, g => g.Select(rp => rp.Permission.Key).ToList());

        return users.Select(u => ToDto(u, permsByRole.GetValueOrDefault(u.RoleId, new()))).ToList();
    }

    public async Task<UserDto> GetAsync(int id)
    {
        var user = await _db.Users.Include(u => u.Role).SingleOrDefaultAsync(u => u.Id == id)
            ?? throw new NotFoundAppException("User", id);
        var perms = await _db.RolePermissions.Where(rp => rp.RoleId == user.RoleId).Select(rp => rp.Permission.Key).ToListAsync();
        return ToDto(user, perms);
    }

    public async Task<UserDto> CreateAsync(CreateUserRequest request)
    {
        if (await _db.Users.AnyAsync(u => u.Username == request.Username))
            throw new ConflictAppException($"Username '{request.Username}' is already taken.");

        PasswordPolicy.Validate(request.Password);
        var role = await _db.Roles.FindAsync(request.RoleId) ?? throw new NotFoundAppException("Role", request.RoleId);
        var (hash, salt) = PasswordHasher.HashPassword(request.Password);

        var user = new User
        {
            FullName = request.FullName,
            Username = request.Username,
            PasswordHash = hash,
            PasswordSalt = salt,
            RoleId = role.Id,
            IsActive = true,
            // An admin just typed this password in, not the person who'll actually use the
            // account — force them to replace it with one only they know at first login.
            MustChangePassword = true
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        var perms = await _db.RolePermissions.Where(rp => rp.RoleId == role.Id).Select(rp => rp.Permission.Key).ToListAsync();
        user.Role = role;
        return ToDto(user, perms);
    }

    public async Task<UserDto> UpdateAsync(int id, UpdateUserRequest request)
    {
        var user = await _db.Users.Include(u => u.Role).SingleOrDefaultAsync(u => u.Id == id)
            ?? throw new NotFoundAppException("User", id);

        var role = await _db.Roles.FindAsync(request.RoleId) ?? throw new NotFoundAppException("Role", request.RoleId);

        // Guard against locking everyone out of user management: if this account is currently the
        // last ACTIVE one whose role grants UsersEdit, deactivating it or moving it to a role
        // without that permission would leave nobody able to fix it back — short of a direct
        // database edit. Previously nothing stopped this (a mistake, or a single compromised
        // admin account, could disable every other admin with no way back).
        var hadUsersEdit = user.IsActive && await _db.RolePermissions
            .AnyAsync(rp => rp.RoleId == user.RoleId && rp.Permission.Key == PermissionKeys.UsersEdit);
        var willHaveUsersEdit = request.IsActive && await _db.RolePermissions
            .AnyAsync(rp => rp.RoleId == role.Id && rp.Permission.Key == PermissionKeys.UsersEdit);

        if (hadUsersEdit && !willHaveUsersEdit)
        {
            var otherActiveAdminExists = await _db.Users
                .Where(u => u.Id != id && u.IsActive)
                .AnyAsync(u => _db.RolePermissions.Any(rp => rp.RoleId == u.RoleId && rp.Permission.Key == PermissionKeys.UsersEdit));
            if (!otherActiveAdminExists)
                throw new ConflictAppException("لا يمكن إلغاء تفعيل هذا الحساب أو تغيير دوره — إنه آخر حساب فعّال يملك صلاحية إدارة المستخدمين، ويجب أن يبقى حساب واحد فعّال على الأقل بهذه الصلاحية.");
        }

        user.FullName = request.FullName;
        user.RoleId = role.Id;
        user.IsActive = request.IsActive;

        if (!string.IsNullOrWhiteSpace(request.NewPassword))
        {
            PasswordPolicy.Validate(request.NewPassword);
            var (hash, salt) = PasswordHasher.HashPassword(request.NewPassword);
            user.PasswordHash = hash;
            user.PasswordSalt = salt;
            // Same reasoning as CreateAsync: an admin-driven reset means the admin now knows
            // this password too, however briefly — force a fresh one only the account holder
            // knows before the account is used again.
            user.MustChangePassword = true;
        }

        await _db.SaveChangesAsync();

        var perms = await _db.RolePermissions.Where(rp => rp.RoleId == role.Id).Select(rp => rp.Permission.Key).ToListAsync();
        user.Role = role;
        return ToDto(user, perms);
    }

    public async Task<IReadOnlyList<RoleDto>> ListRolesAsync()
    {
        var roles = await _db.Roles.Include(r => r.RolePermissions).ThenInclude(rp => rp.Permission).ToListAsync();
        return roles.Select(r => new RoleDto(r.Id, r.Name, r.Description, r.RolePermissions.Select(rp => rp.Permission.Key).ToList())).ToList();
    }

    private static UserDto ToDto(User u, List<string> permissions) =>
        new(u.Id, u.FullName, u.Username, u.Role.Name, u.IsActive, permissions);
}
