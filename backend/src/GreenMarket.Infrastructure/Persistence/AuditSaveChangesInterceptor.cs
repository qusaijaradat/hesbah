using System.Text.Json;
using GreenMarket.Domain.Common;
using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GreenMarket.Infrastructure.Persistence;

/// <summary>
/// Writes one AuditLog row per changed entity, with a JSON {field: {old, new}} diff.
/// Requirement doc §14: "a complete record for every edit, who made it and when" —
/// implemented as an interceptor (rather than inside AppDbContext.SaveChanges) because
/// it needs the *pre-save* ChangeTracker state (original values) to compute a diff;
/// by the time SaveChanges returns, EF has already reset "Modified" markers to "Unchanged".
/// </summary>
public class AuditSaveChangesInterceptor : SaveChangesInterceptor
{
    private readonly ICurrentUserAccessor? _currentUser;
    private List<AuditLog>? _pendingLogs;

    public AuditSaveChangesInterceptor(ICurrentUserAccessor? currentUser = null)
    {
        _currentUser = currentUser;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        _pendingLogs = BuildAuditLogs(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        _pendingLogs = BuildAuditLogs(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        FlushPendingLogs(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        FlushPendingLogs(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    private List<AuditLog> BuildAuditLogs(DbContext? context)
    {
        var logs = new List<AuditLog>();
        if (context is null) return logs;

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.Entity is AuditLog) continue; // never audit the audit table itself
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;

            var action = entry.State switch
            {
                EntityState.Added => "Created",
                EntityState.Deleted => "Deleted",
                _ when entry.Entity is AuditableEntity ae && entry.Property(nameof(AuditableEntity.IsDeleted)).IsModified && ae.IsDeleted => "Cancelled",
                _ => "Updated"
            };

            var changes = BuildChangeDictionary(entry);
            if (changes.Count == 0 && action == "Updated") continue;

            logs.Add(new AuditLog
            {
                At = DateTimeOffset.UtcNow,
                UserId = _currentUser?.UserId,
                EntityName = entry.Entity.GetType().Name,
                EntityId = GetEntityId(entry),
                Action = action,
                ChangesJson = JsonSerializer.Serialize(changes)
            });
        }

        return logs;
    }

    private static Dictionary<string, object?> BuildChangeDictionary(EntityEntry entry)
    {
        var changes = new Dictionary<string, object?>();
        foreach (var property in entry.Properties)
        {
            if (entry.State == EntityState.Added)
            {
                changes[property.Metadata.Name] = property.CurrentValue;
            }
            else if (entry.State == EntityState.Modified && property.IsModified)
            {
                changes[property.Metadata.Name] = new { old = property.OriginalValue, @new = property.CurrentValue };
            }
        }
        return changes;
    }

    private static string GetEntityId(EntityEntry entry)
    {
        var key = entry.Metadata.FindPrimaryKey();
        if (key is null) return "";
        var values = key.Properties.Select(p => entry.Property(p.Name).CurrentValue?.ToString() ?? "");
        return string.Join(",", values);
    }

    private void FlushPendingLogs(DbContext? context)
    {
        if (context is null || _pendingLogs is null || _pendingLogs.Count == 0) return;

        context.Set<AuditLog>().AddRange(_pendingLogs);
        _pendingLogs = null;
        context.SaveChanges(); // separate round-trip: audit rows must exist even if caller's transaction already committed
    }
}
