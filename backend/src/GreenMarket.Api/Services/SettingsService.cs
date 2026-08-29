using System.Globalization;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §5: the commission rate must be a configurable setting, not hard-coded.</summary>
public interface ISettingsService
{
    Task<IReadOnlyList<SettingDto>> ListAsync();
    Task<decimal> GetDecimalAsync(string key, decimal fallback);
    Task<SettingDto> UpdateAsync(string key, string value, int updatedByUserId);
}

public class SettingsService : ISettingsService
{
    private readonly AppDbContext _db;

    public SettingsService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<SettingDto>> ListAsync() =>
        await _db.Settings.OrderBy(s => s.Key).Select(s => new SettingDto(s.Key, s.Value, s.Description)).ToListAsync();

    public async Task<decimal> GetDecimalAsync(string key, decimal fallback)
    {
        var setting = await _db.Settings.FindAsync(key);
        if (setting is null) return fallback;
        return decimal.TryParse(setting.Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? value : fallback;
    }

    public async Task<SettingDto> UpdateAsync(string key, string value, int updatedByUserId)
    {
        var setting = await _db.Settings.FindAsync(key);
        if (setting is null)
        {
            setting = new Setting { Key = key };
            _db.Settings.Add(setting);
        }
        setting.Value = value;
        setting.UpdatedAt = DateTimeOffset.UtcNow;
        setting.UpdatedByUserId = updatedByUserId;
        await _db.SaveChangesAsync();
        return new SettingDto(setting.Key, setting.Value, setting.Description);
    }
}
