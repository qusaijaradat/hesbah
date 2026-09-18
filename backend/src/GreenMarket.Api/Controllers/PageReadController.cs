using GreenMarket.Api.Auth;
using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services.Ask;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// Reads a photographed ledger page into rows — see Services.Ask.PageReader.
///
/// InvoicesCreate, because the only thing the answer is good for is filling an entry form: it
/// writes nothing, and somebody who may not create an invoice has nowhere to put what comes back.
/// </summary>
[ApiController]
[Authorize]
[Route("api/page-read")]
public class PageReadController : ControllerBase
{
    /// <summary>
    /// A photographed page, at a size a phone actually produces. Above this the request is refused
    /// rather than truncated — half a page read is worse than none, because the missing half looks
    /// like a page that simply had fewer rows.
    /// </summary>
    private const long MaxBytes = 8 * 1024 * 1024;

    /// <summary>What the model accepts. Anything else is refused by name rather than sent and failed.</summary>
    private static readonly string[] AllowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    private readonly IPageReader _reader;

    public PageReadController(IPageReader reader) => _reader = reader;

    /// <summary>Whether a key is configured at all, so the screen hides the button instead of
    /// offering one that always fails.</summary>
    [HttpGet("status")]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    public ActionResult<object> Status() => Ok(new { configured = _reader.IsConfigured });

    [HttpPost]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    [RequestSizeLimit(MaxBytes + (512 * 1024))]
    public async Task<ActionResult<PageReadResult>> Read(IFormFile image, CancellationToken cancellationToken)
    {
        if (!_reader.IsConfigured)
            throw new ValidationAppException("قراءة الصور مش مفعّلة على هذا السيرفر.");
        if (image is null || image.Length == 0)
            throw new ValidationAppException("ما في صورة.");
        if (image.Length > MaxBytes)
            throw new ValidationAppException("الصورة كبيرة كثير. صوّر الصفحة بجودة أقل أو اقصّها.");

        var mediaType = image.ContentType?.ToLowerInvariant() ?? "";
        if (!AllowedTypes.Contains(mediaType))
            throw new ValidationAppException("نوع الصورة غير مدعوم. استخدم JPG أو PNG.");

        using var buffer = new MemoryStream();
        await image.CopyToAsync(buffer, cancellationToken);

        return Ok(await _reader.ReadAsync(buffer.ToArray(), mediaType, cancellationToken));
    }
}
