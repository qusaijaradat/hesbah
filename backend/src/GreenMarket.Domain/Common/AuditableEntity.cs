namespace GreenMarket.Domain.Common;

/// <summary>
/// Base for every persisted entity. Carries the fields <c>AuditLogs</c> (requirement
/// doc §14 "a complete log of every edit, who made it and when") needs to reconstruct
/// history without inspecting the whole table.
/// </summary>
public abstract class AuditableEntity
{
    public int Id { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public int? CreatedByUserId { get; set; }

    public DateTimeOffset? UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }

    /// <summary>
    /// Soft-delete flag. Financial records (invoices, payments) are never hard-deleted —
    /// requirement doc §2 calls the action "cancel" for invoices specifically, and we
    /// extend the same principle everywhere money is involved so reports stay reconcilable.
    /// </summary>
    public bool IsDeleted { get; set; }
}
