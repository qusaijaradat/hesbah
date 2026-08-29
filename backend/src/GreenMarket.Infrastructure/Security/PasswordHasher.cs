using System.Security.Cryptography;

namespace GreenMarket.Infrastructure.Security;

/// <summary>
/// PBKDF2-HMACSHA256 password hashing. Uses only System.Security.Cryptography (no
/// third-party package) — deliberately, so this one piece of security-critical code
/// has the smallest possible dependency surface.
/// </summary>
public static class PasswordHasher
{
    private const int SaltSizeBytes = 16;
    private const int HashSizeBytes = 32;
    private const int Iterations = 210_000; // OWASP 2023 minimum recommendation for PBKDF2-SHA256

    public static (string Hash, string Salt) HashPassword(string password)
    {
        var saltBytes = RandomNumberGenerator.GetBytes(SaltSizeBytes);
        var hashBytes = Rfc2898DeriveBytes.Pbkdf2(password, saltBytes, Iterations, HashAlgorithmName.SHA256, HashSizeBytes);
        return (Convert.ToBase64String(hashBytes), Convert.ToBase64String(saltBytes));
    }

    public static bool Verify(string password, string storedHash, string storedSalt)
    {
        var saltBytes = Convert.FromBase64String(storedSalt);
        var expected = Convert.FromBase64String(storedHash);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, saltBytes, Iterations, HashAlgorithmName.SHA256, HashSizeBytes);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}
