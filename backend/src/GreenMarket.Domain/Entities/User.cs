using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// Requirement doc §2: "no one may access the system without an account" — every
/// action in the system is attributed to a User for the AuditLog trail.
/// </summary>
public class User : AuditableEntity
{
    public string FullName { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;

    /// <summary>PBKDF2 password hash — never store or log the plaintext password.</summary>
    public string PasswordHash { get; set; } = string.Empty;
    public string PasswordSalt { get; set; } = string.Empty;

    public int RoleId { get; set; }
    public Role Role { get; set; } = null!;

    /// <summary>Disabled accounts (requirement doc §2 "activate/deactivate") can't log in but keep their history.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Set whenever an admin creates the account or resets its password — forces the
    /// holder to pick their own password at next login instead of an admin/seed value staying
    /// live indefinitely (this is how the default seeded admin account gets forced off
    /// "ChangeMe123!" on first use).</summary>
    public bool MustChangePassword { get; set; } = true;

    /// <summary>Consecutive failed login attempts since the last success — reset to 0 on a
    /// successful login. Backs the lockout in <see cref="LockedUntil"/>.</summary>
    public int FailedLoginAttempts { get; set; }

    /// <summary>Set after too many consecutive failed attempts; login is refused until this
    /// time passes, regardless of whether the password given afterward is correct.</summary>
    public DateTimeOffset? LockedUntil { get; set; }
}
