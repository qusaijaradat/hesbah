namespace GreenMarket.Api.Common;

/// <summary>
/// The one place password strength is decided — previously there was no check at all (a
/// 1-character password was accepted), so this exists as a single shared gate every code path
/// that sets a password (admin creating a user, admin resetting a password, a user changing
/// their own password) must call, rather than each reimplementing its own rule.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 8;

    public static void Validate(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < MinLength)
            throw new ValidationAppException($"يجب أن تتكوّن كلمة المرور من {MinLength} أحرف على الأقل.");
    }
}
