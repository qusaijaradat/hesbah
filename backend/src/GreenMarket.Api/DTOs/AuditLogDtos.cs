namespace GreenMarket.Api.DTOs;

/// <summary>Requirement doc §14: "a complete record for every edit — who made it and when."
/// UserFullName is resolved server-side (rather than making the frontend hold a user-id-to-name
/// map) since the acting user may since have been deactivated or renamed.</summary>
public record AuditLogDto(
    long Id, DateTimeOffset At, int? UserId, string? UserFullName,
    string EntityName, string EntityId, string Action, string? ChangesJson);

public class AuditLogFilterRequest
{
    public string? EntityName { get; set; }
    public string? Action { get; set; }
    public int? UserId { get; set; }
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 25;
}
