namespace GreenMarket.Api.DTOs;

/// <summary>A kind of sack the market distinguishes — a colour, a shape. Created from the picker.</summary>
public record SackKindDto(int Id, string Name, bool IsActive);

public record CreateSackKindRequest(string Name);
public record UpdateSackKindRequest(string Name, bool IsActive);

/// <summary>
/// One kind and how many of it, inside a single handover or return.
///
/// The reason this feature is not just a number: somebody takes fifty sacks — thirty red and
/// twenty yellow — and brings back fifty yellow. A single count says they are square. Per kind,
/// they owe thirty red and the market owes them thirty yellow, which is the truth and the whole
/// point of recording it.
/// </summary>
public record SackLineRequest(int? SackKindId, decimal Quantity);

/// <summary>
/// "سحب" or "ارتجاع": one person, one date, and any number of kinds at once.
///
/// One request rather than one per kind, because thirty red and twenty yellow handed over together
/// are ONE event. Recorded as separate requests they can half-succeed, and a half-recorded
/// handover is a person holding sacks nobody wrote down.
/// </summary>
public record CreateSackMovementRequest(
    int PartnerId,
    DateTimeOffset Date,
    IReadOnlyList<SackLineRequest> Lines,
    string? Notes = null);

/// <summary>One recorded line, as it reads back on a report or a person's page.</summary>
public record SackMovementDto(
    int Id,
    int PartnerId,
    string PartnerName,
    int? SackKindId,
    /// <summary>"بدون نوع" for the rows recorded before kinds existed — see ContainerMovement.SackKindId.</summary>
    string SackKindName,
    string Direction,
    DateTimeOffset Date,
    decimal Quantity,
    string? Notes);

/// <summary>
/// The market's own position in one kind: how many went out, how many came back, and the
/// difference — which is how many of that kind are in other people's hands right now.
/// </summary>
public record SackKindTotalDto(int? SackKindId, string SackKindName, decimal Out, decimal In, decimal Outstanding);

/// <summary>One person's position in one kind. Carries their WhatsApp number so the row itself can
/// send them what they owe — looking it up separately would be a second round trip per row.</summary>
public record SackPartnerKindDto(
    int PartnerId, string PartnerName, string? PartnerWhatsApp,
    int? SackKindId, string SackKindName, decimal Out, decimal In, decimal Outstanding);

/// <summary>
/// Everything the sacks section shows, for one period.
///
/// Totals, per-person-per-kind lines and the movement log come back together because they are
/// three views of one query and a screen that fetched them separately could show three answers
/// that disagree by however long the round trips took.
/// </summary>
public record SacksOverviewDto(
    DateTimeOffset? DateFrom,
    DateTimeOffset? DateTo,
    IReadOnlyList<SackKindTotalDto> Totals,
    IReadOnlyList<SackPartnerKindDto> ByPartner,
    IReadOnlyList<SackMovementDto> Movements);
