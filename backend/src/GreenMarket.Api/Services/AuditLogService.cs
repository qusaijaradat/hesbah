using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>Requirement doc §14, read side: the AuditLog table has existed since the initial
/// build (written by AuditSaveChangesInterceptor) but had no screen or endpoint to view it —
/// this is that missing read path.</summary>
public interface IAuditLogService
{
    Task<PagedResult<AuditLogDto>> ListAsync(AuditLogFilterRequest filter);
    Task<IReadOnlyList<string>> ListEntityNamesAsync();
}

public class AuditLogService : IAuditLogService
{
    private readonly AppDbContext _db;
    public AuditLogService(AppDbContext db) => _db = db;

    public async Task<PagedResult<AuditLogDto>> ListAsync(AuditLogFilterRequest filter)
    {
        var query = _db.AuditLogs.AsQueryable();

        if (!string.IsNullOrWhiteSpace(filter.EntityName)) query = query.Where(a => a.EntityName == filter.EntityName);
        if (!string.IsNullOrWhiteSpace(filter.Action)) query = query.Where(a => a.Action == filter.Action);
        if (filter.UserId is not null) query = query.Where(a => a.UserId == filter.UserId);
        if (filter.DateFrom is not null) query = query.Where(a => a.At >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(a => a.At <= filter.DateTo);

        var total = await query.CountAsync();
        var page = filter.Page < 1 ? 1 : filter.Page;
        var pageSize = filter.PageSize is < 1 or > 200 ? 25 : filter.PageSize;

        var rows = await query.OrderByDescending(a => a.At)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync();

        // Resolved separately (not a SQL join) so a since-deleted user id still shows the log
        // row instead of silently dropping it — IsDeleted users are excluded by the default
        // query filter on a normal Include/join.
        var userIds = rows.Where(r => r.UserId is not null).Select(r => r.UserId!.Value).Distinct().ToList();
        var namesById = await _db.Users.IgnoreQueryFilters()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.FullName);

        var items = rows.Select(a => new AuditLogDto(
            a.Id, a.At, a.UserId,
            a.UserId is not null ? namesById.GetValueOrDefault(a.UserId.Value) : null,
            a.EntityName, a.EntityId, a.Action, a.ChangesJson)).ToList();

        return new PagedResult<AuditLogDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    /// <summary>Distinct entity names actually present in the log, for the filter dropdown —
    /// avoids hardcoding a list on either side that could drift from what's really been recorded.</summary>
    public async Task<IReadOnlyList<string>> ListEntityNamesAsync() =>
        await _db.AuditLogs.Select(a => a.EntityName).Distinct().OrderBy(n => n).ToListAsync();
}
