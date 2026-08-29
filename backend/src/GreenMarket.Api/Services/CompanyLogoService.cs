using System.Reflection;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// The market's uploaded logo (Settings page → "الشعار") — a single row, always Id = 1. Shown on
/// the printed invoice header (see ExportService) alongside/instead of the plain-text company name.
/// Until the market uploads their own, GetEffectiveLogoAsync falls back to the "أرديس" logo bundled
/// with the app (Assets/default-logo.png, embedded in the DLL) — so invoices always show *some*
/// logo, matching what the Settings page previews before anything's been uploaded.
/// </summary>
public interface ICompanyLogoService
{
    /// <summary>The market's own uploaded logo, or null if they haven't uploaded one — used by the
    /// Settings page, which needs to tell "nothing uploaded yet" apart from "uploaded a logo".</summary>
    Task<CompanyLogo?> GetAsync();

    /// <summary>What should actually be printed on an invoice right now: the uploaded logo if one
    /// exists, otherwise the bundled default "أرديس" logo. Never null/empty.</summary>
    Task<(byte[] Content, string ContentType)> GetEffectiveLogoAsync();

    Task<CompanyLogo> SetAsync(byte[] content, string contentType, int updatedByUserId);
    Task DeleteAsync();
}

public class CompanyLogoService : ICompanyLogoService
{
    private const int SingletonId = 1;
    private readonly AppDbContext _db;

    // Loaded once per process and cached — this is a static asset baked into the DLL, it never
    // changes at runtime, so there's no reason to re-extract it from the assembly's manifest on
    // every single invoice print.
    private static readonly Lazy<(byte[] Content, string ContentType)> DefaultLogo = new(() =>
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("default-logo.png", StringComparison.OrdinalIgnoreCase));
        if (resourceName is null)
            throw new InvalidOperationException(
                "Bundled default logo (Assets/default-logo.png) not found as an embedded resource — " +
                "check the <EmbeddedResource> entry in GreenMarket.Api.csproj.");

        using var stream = assembly.GetManifestResourceStream(resourceName)!;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return (memory.ToArray(), "image/png");
    });

    public CompanyLogoService(AppDbContext db) => _db = db;

    public Task<CompanyLogo?> GetAsync() =>
        _db.CompanyLogos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == SingletonId);

    public async Task<(byte[] Content, string ContentType)> GetEffectiveLogoAsync()
    {
        CompanyLogo? custom;
        try
        {
            custom = await GetAsync();
        }
        catch
        {
            // e.g. the company_logos table doesn't exist for some reason (see Program.cs's
            // defensive CREATE TABLE guard) — fall back to the bundled default rather than
            // breaking invoice PDF generation over what should be a "nice to have" feature.
            custom = null;
        }
        return custom is not null ? (custom.Content, custom.ContentType) : DefaultLogo.Value;
    }

    public async Task<CompanyLogo> SetAsync(byte[] content, string contentType, int updatedByUserId)
    {
        var logo = await _db.CompanyLogos.FirstOrDefaultAsync(x => x.Id == SingletonId);
        if (logo is null)
        {
            logo = new CompanyLogo { Id = SingletonId };
            _db.CompanyLogos.Add(logo);
        }
        logo.Content = content;
        logo.ContentType = contentType;
        logo.UpdatedAt = DateTimeOffset.UtcNow;
        logo.UpdatedByUserId = updatedByUserId;
        await _db.SaveChangesAsync();
        return logo;
    }

    public async Task DeleteAsync()
    {
        var logo = await _db.CompanyLogos.FirstOrDefaultAsync(x => x.Id == SingletonId);
        if (logo is null) return;
        _db.CompanyLogos.Remove(logo);
        await _db.SaveChangesAsync();
    }
}
