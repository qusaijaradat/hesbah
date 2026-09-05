using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §5: the commission rate (and other settings) must be configurable, not hard-coded.</summary>
[ApiController]
[Authorize]
[Route("api/settings")]
public class SettingsController : ControllerBase
{
    private readonly ISettingsService _settingsService;
    private readonly ICompanyLogoService _logoService;

    private static readonly HashSet<string> AllowedLogoContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/webp"
    };
    private const long MaxLogoBytes = 3 * 1024 * 1024; // 3 MB — generous for a header logo, small enough to keep the PDF/API snappy

    public SettingsController(ISettingsService settingsService, ICompanyLogoService logoService)
    {
        _settingsService = settingsService;
        _logoService = logoService;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.SettingsView)]
    public async Task<ActionResult<IReadOnlyList<SettingDto>>> List() => Ok(await _settingsService.ListAsync());

    [HttpPut("{key}")]
    [RequirePermission(PermissionKeys.SettingsEdit)]
    public async Task<ActionResult<SettingDto>> Update(string key, UpdateSettingRequest request) =>
        Ok(await _settingsService.UpdateAsync(key, request.Value, CurrentUserId.Require(User)));

    /// <summary>
    /// Returns the raw image bytes of the uploaded logo (204 if none has been uploaded yet). Kept
    /// behind auth like every other Settings endpoint — the frontend fetches it as a blob (same
    /// pattern as the invoice PDF downloads) rather than pointing an &lt;img&gt; tag straight at it,
    /// since a plain &lt;img src&gt; can't carry the Authorization header.
    /// </summary>
    [HttpGet("logo")]
    [RequirePermission(PermissionKeys.SettingsView)]
    public async Task<IActionResult> GetLogo()
    {
        var logo = await _logoService.GetAsync();
        if (logo is null) return NoContent();
        return File(logo.Content, logo.ContentType);
    }

    /// <summary>Uploads (or replaces) the market's logo, shown in Settings and on the invoice PDF header.</summary>
    [HttpPost("logo")]
    [RequirePermission(PermissionKeys.SettingsEdit)]
    [RequestSizeLimit(MaxLogoBytes)]
    public async Task<IActionResult> UploadLogo(IFormFile file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "يرجى اختيار صورة." });
        if (file.Length > MaxLogoBytes)
            return BadRequest(new { error = "حجم الصورة كبير جدًا (الحد الأقصى 3 ميغابايت)." });
        if (!AllowedLogoContentTypes.Contains(file.ContentType))
            return BadRequest(new { error = "الصيغة غير مدعومة — استخدم PNG أو JPEG أو WEBP." });

        using var stream = new MemoryStream();
        await file.CopyToAsync(stream);
        var bytes = stream.ToArray();

        // Content-Type above is just a header the browser sends — anyone can claim any file is
        // "image/png". This checks the actual file bytes match a real image of the claimed kind,
        // so a renamed/relabeled non-image file can't be stored and then served back to every user
        // who opens Settings (or printed onto every invoice) under a false image content type.
        if (!MatchesImageSignature(bytes, file.ContentType))
            return BadRequest(new { error = "محتوى الملف لا يطابق صيغة صورة صالحة." });

        await _logoService.SetAsync(bytes, file.ContentType, CurrentUserId.Require(User));
        return NoContent();
    }

    private static bool MatchesImageSignature(byte[] bytes, string contentType)
    {
        switch (contentType.ToLowerInvariant())
        {
            case "image/png":
                return bytes.Length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
                    && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A;
            case "image/jpeg":
                return bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
            case "image/webp":
                return bytes.Length >= 12
                    && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                    && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P';
            default:
                return false;
        }
    }

    [HttpDelete("logo")]
    [RequirePermission(PermissionKeys.SettingsEdit)]
    public async Task<IActionResult> DeleteLogo()
    {
        await _logoService.DeleteAsync();
        return NoContent();
    }
}
