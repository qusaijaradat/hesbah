namespace GreenMarket.Api.DTOs;

public record LoginRequest(string Username, string Password);

/// <summary>MustChangePassword tells the frontend to route straight to the forced
/// change-password screen before anything else — the token itself is still valid (it can
/// authorize the change-password call), it's a UX gate, not an authorization gate.</summary>
public record LoginResponse(string Token, DateTimeOffset ExpiresAt, UserDto User, bool MustChangePassword);

public record UserDto(int Id, string FullName, string Username, string RoleName, bool IsActive, IReadOnlyList<string> Permissions);

public record CreateUserRequest(string FullName, string Username, string Password, int RoleId);

public record UpdateUserRequest(string FullName, int RoleId, bool IsActive, string? NewPassword);

public record RoleDto(int Id, string Name, string? Description, IReadOnlyList<string> Permissions);

/// <summary>One selectable permission for the role-editing checklist (roadmap: "UI for
/// creating/editing custom roles and their permission grants" — previously DB-only despite the
/// README describing roles as fully editable).</summary>
public record PermissionDto(int Id, string Key, string? Description);

public record CreateRoleRequest(string Name, string? Description, IReadOnlyList<string> PermissionKeys);

public record UpdateRoleRequest(string Name, string? Description, IReadOnlyList<string> PermissionKeys);

/// <summary>Self-service password change — requires knowing the current password (unlike an
/// admin-driven reset via UpdateUserRequest), so this can be exposed to every logged-in user
/// regardless of role.</summary>
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
