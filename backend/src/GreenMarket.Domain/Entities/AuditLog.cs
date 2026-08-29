namespace GreenMarket.Domain.Entities;

/// <summary>
/// Requirement doc §14 future feature promoted into the initial build: "a complete
/// record for every edit — who made it and when." Written by a SaveChanges interceptor
/// in the Infrastructure layer so no controller/service has to remember to call it.
/// </summary>
public class AuditLog
{
    public long Id { get; set; }

    public DateTimeOffset At { get; set; }
    public int? UserId { get; set; }

    /// <summary>e.g. "Invoice", "Payment", "Partner".</summary>
    public string EntityName { get; set; } = string.Empty;
    public string EntityId { get; set; } = string.Empty;

    /// <summary>"Created" | "Updated" | "Deleted" | "Cancelled".</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>JSON snapshot of changed field -> {old, new}, for a human-readable diff view.</summary>
    public string? ChangesJson { get; set; }
}
