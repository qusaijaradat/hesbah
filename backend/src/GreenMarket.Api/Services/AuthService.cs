using GreenMarket.Api.Auth;
using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Infrastructure.Persistence;
using GreenMarket.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IAuthService
{
    Task<LoginResponse> LoginAsync(LoginRequest request);
    Task ChangePasswordAsync(int userId, ChangePasswordRequest request);
}

public class AuthService : IAuthService
{
    // After this many consecutive wrong-password attempts, the account is locked for
    // LockoutDuration regardless of how correct the next attempt is — there was previously no
    // limit at all, so a password could be guessed at unlimited speed.
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    private readonly AppDbContext _db;
    private readonly IJwtTokenGenerator _jwt;

    public AuthService(AppDbContext db, IJwtTokenGenerator jwt)
    {
        _db = db;
        _jwt = jwt;
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request)
    {
        var user = await _db.Users.Include(u => u.Role)
            .SingleOrDefaultAsync(u => u.Username == request.Username);

        // Requirement doc §2: "no one may access the system without an account" — deliberately
        // generic error message for both "no such user" and "wrong password" so login can't be
        // used to enumerate valid usernames.
        if (user is null)
            throw new UnauthorizedAppException("Invalid username or password.");

        if (user.LockedUntil is not null && user.LockedUntil > DateTimeOffset.UtcNow)
            throw new UnauthorizedAppException("This account is temporarily locked after too many failed attempts. Try again later.");

        if (!PasswordHasher.Verify(request.Password, user.PasswordHash, user.PasswordSalt))
        {
            user.FailedLoginAttempts++;
            if (user.FailedLoginAttempts >= MaxFailedAttempts)
            {
                user.LockedUntil = DateTimeOffset.UtcNow.Add(LockoutDuration);
                user.FailedLoginAttempts = 0;
            }
            await _db.SaveChangesAsync();
            throw new UnauthorizedAppException("Invalid username or password.");
        }

        if (!user.IsActive)
            throw new UnauthorizedAppException("This account has been disabled.");

        // A correct password clears any accumulated failed attempts — only *consecutive*
        // failures should ever be able to trigger a lockout.
        user.FailedLoginAttempts = 0;
        user.LockedUntil = null;
        await _db.SaveChangesAsync();

        var (token, expiresAt) = await _jwt.GenerateAsync(user);
        var permissions = await _db.RolePermissions
            .Where(rp => rp.RoleId == user.RoleId)
            .Select(rp => rp.Permission.Key)
            .ToListAsync();

        var dto = new UserDto(user.Id, user.FullName, user.Username, user.Role.Name, user.IsActive, permissions);
        return new LoginResponse(token, expiresAt, dto, user.MustChangePassword);
    }

    /// <summary>Self-service password change — the only path where the caller only proves
    /// identity via a currently-known password, not admin privilege, so it's the right place to
    /// clear MustChangePassword: from here on, only the account holder knows this password.</summary>
    public async Task ChangePasswordAsync(int userId, ChangePasswordRequest request)
    {
        var user = await _db.Users.FindAsync(userId) ?? throw new NotFoundAppException("User", userId);

        // Deliberately a 400, not a 401: the caller IS authenticated (their bearer token is
        // fine) — a wrong current password here is a validation failure on this one action, not
        // an authentication failure. The frontend's global axios interceptor force-logs-out and
        // redirects to /login on any 401, which would otherwise kick someone back to the login
        // screen just for mistyping their current password on this form.
        if (!PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash, user.PasswordSalt))
            throw new ValidationAppException("كلمة المرور الحالية غير صحيحة.");

        PasswordPolicy.Validate(request.NewPassword);

        var (hash, salt) = PasswordHasher.HashPassword(request.NewPassword);
        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        user.MustChangePassword = false;
        await _db.SaveChangesAsync();
    }
}
