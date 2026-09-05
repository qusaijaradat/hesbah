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

    /// <summary>
    /// FailedLoginAttempts churns on literally every login attempt (success resets it to 0,
    /// failure increments it) — previously that alone was enough to log a full "Updated" audit
    /// row for the User entity on every single login, burying genuinely meaningful changes
    /// (a role switch, a deactivation, a cancelled invoice on some other entity) in hundreds of
    /// daily login-noise rows. Excluded from the diff entirely so a login attempt that touches
    /// ONLY this field produces no audit row at all (see BuildAuditLogs' existing "changes.Count
    /// == 0" skip) — a real account change bundled with other fields still logs those normally.
    /// </summary>
    private static readonly HashSet<string> ExcludedFromDiff = new() { nameof(User.FailedLoginAttempts) };

    /// <summary>Never write the actual password hash/salt value into the audit trail — previously
    /// an admin-driven password reset (UserService.UpdateAsync) logged both the old AND new
    /// encrypted values verbatim, readable by anyone with audit-log access. The fact that a
    /// password WAS changed is still worth keeping (a real, investigable account event), just not
    /// the value itself.</summary>
    private static readonly HashSet<string> RedactedInDiff = new() { nameof(User.PasswordHash), nameof(User.PasswordSalt) };

    private static Dictionary<string, object?> BuildChangeDictionary(EntityEntry entry)
    {
        var changes = new Dictionary<string, object?>();
        foreach (var property in entry.Properties)
        {
            var name = property.Metadata.Name;
            if (entry.Entity is User && ExcludedFromDiff.Contains(name)) continue;

            if (entry.State == EntityState.Added)
            {
                changes[name] = entry.Entity is User && RedactedInDiff.Contains(name) ? "(محجوب)" : property.CurrentValue;
            }
            else if (entry.State == EntityState.Modified && property.IsModified)
            {
                changes[name] = entry.Entity is User && RedactedInDiff.Contains(name)
                    ? new { old = "(محجوب)", @new = "(محجوب)" }
                    : new { old = property.OriginalValue, @new = property.CurrentValue };
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
