using GreenMarket.Api.Auth;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// "نسخة احتياطية" — see BackupService for what the file contains and, just as importantly, what it
/// does not. Its own controller rather than another action on Reports: this is not a report, and
/// keeping it separate means its heavier permission can't be granted by accident along with the
/// reporting ones.
/// </summary>
[ApiController]
[Authorize]
[Route("api/backup")]
public class BackupController : ControllerBase
{
    private readonly IBackupService _backupService;

    public BackupController(IBackupService backupService) => _backupService = backupService;

    [HttpGet("download")]
    [RequirePermission(PermissionKeys.BackupDownload)]
    public async Task<IActionResult> Download(CancellationToken cancellationToken)
    {
        var bytes = await _backupService.CreateCsvArchiveAsync(cancellationToken);
        // Dated filename so backups taken on different days don't overwrite each other in the
        // downloads folder — the most likely place these actually live.
        var fileName = $"hesbah-backup-{DateTimeOffset.Now:yyyy-MM-dd-HHmm}.zip";
        return File(bytes, "application/zip", fileName);
    }
}
