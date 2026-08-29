using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace GreenMarket.Api.Auth;

public interface IJwtTokenGenerator
{
    Task<(string Token, DateTimeOffset ExpiresAt)> GenerateAsync(User user);
}

public class JwtTokenGenerator : IJwtTokenGenerator
{
    private readonly JwtSettings _settings;
    private readonly AppDbContext _db;

    public JwtTokenGenerator(IOptions<JwtSettings> settings, AppDbContext db)
    {
        _settings = settings.Value;
        _db = db;
    }

    public async Task<(string Token, DateTimeOffset ExpiresAt)> GenerateAsync(User user)
    {
        var permissionKeys = await _db.RolePermissions
            .Where(rp => rp.RoleId == user.RoleId)
            .Select(rp => rp.Permission.Key)
            .ToListAsync();

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypesExtra.UserId, user.Id.ToString()),
            new(ClaimTypes.Name, user.FullName),
            new("username", user.Username),
            new(ClaimTypesExtra.RoleName, user.Role?.Name ?? string.Empty),
        };
        claims.AddRange(permissionKeys.Select(key => new Claim(ClaimTypesExtra.Permission, key)));

        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_settings.AccessTokenMinutes);
        var keyBytes = Encoding.UTF8.GetBytes(_settings.SigningKey);
        var credentials = new SigningCredentials(new SymmetricSecurityKey(keyBytes), SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            expires: expiresAt.UtcDateTime,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
