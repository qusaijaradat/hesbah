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
        await _logoService.SetAsync(stream.ToArray(), file.ContentType, CurrentUserId.Require(User));
        return NoContent();
    }

    [HttpDelete("logo")]
    [RequirePermission(PermissionKeys.SettingsEdit)]
    public async Task<IActionResult> DeleteLogo()
    {
        await _logoService.DeleteAsync();
        return NoContent();
    }
}
