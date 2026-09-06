using System.Globalization;
using GreenMarket.Api.Common;
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
        ValidateValue(key, value);

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

    /// <summary>
    /// Previously any string saved here was accepted as-is — a typo in the commission rate (e.g.
    /// "1.5" instead of "0.07", or non-numeric text) would sit fine until the very next invoice
    /// tried to read it, at which point CommissionCalculator/InvoiceService would throw on every
    /// single new/edited invoice market-wide until someone noticed and fixed it manually. Every
    /// known numeric setting is now checked for a well-formed value in its expected range right
    /// when it's saved; unknown/free-text keys (market name, phone, address, etc.) are untouched.
    /// </summary>
    private static void ValidateValue(string key, string value)
    {
        switch (key)
        {
            case Setting.Keys.DefaultCommissionRate:
                if (!decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var rate) || rate < 0 || rate > 1)
                    throw new ValidationAppException("نسبة العمولة يجب أن تكون رقمًا عشريًا بين 0 و1 (مثال: 0.10 لنسبة 10%).");
                break;
            case Setting.Keys.BoxPrice:
            case Setting.Keys.DriverBoxFee:
                if (!decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var fee) || fee < 0)
                    throw new ValidationAppException("القيمة يجب أن تكون رقمًا أكبر من أو يساوي صفر.");
                break;
        }
    }
}
