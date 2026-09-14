namespace GreenMarket.Api.DTOs;

public record LoginRequest(string Username, string Password);

/// <summary>MustChangePassword tells the frontend to route straight to the forced
/// change-password screen before anything else — the token itself is still valid (it can
/// authorize the change-password call), it's a UX gate, not an authorization gate.</summary>
public record LoginResponse(string Token, DateTimeOffset ExpiresAt, UserDto User, bool MustChangePassword);

public record UserDto(int Id, string FullName, string Username, string RoleName, bool IsActive, IReadOnlyList<string> Permissions);

public record CreateUserRequest(string FullName, string Username, string Password, int RoleId);

public record UpdateUserRequest(string FullName, int RoleId, bool IsActive, string? NewPassword);

/// <param name="AlertFamilies">
/// Which alerts this role actually RECEIVES — "Checks", "Invoices", "Sacks" — worked out by
/// Domain.Services.AlertVisibility from the permissions above, never by the screen showing it.
///
/// It is here because the rule is not guessable from the permission list by eye: an alert needs
/// the permission that opens the page AND the one that fixes the thing, so a role holding
/// invoices.view and not invoices.edit is told nothing about invoices while plainly looking as if
/// it should be. Somebody deciding what a role is for has to be able to SEE that, or the setting
/// is one only whoever wrote the rule can reason about.
///
/// The families, not the Arabic. Same split as the alerts banner: the server returns the facts and
/// the screen decides how to say them.
/// </param>
public record RoleDto(
    int Id, string Name, string? Description, IReadOnlyList<string> Permissions,
    IReadOnlyList<string> AlertFamilies);

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
