using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>One recorded movement of empty containers — see ContainerMovement.</summary>
public record ContainerMovementDto(
    int Id, int PartnerId, ContainerType Type, ContainerDirection Direction,
    DateTimeOffset Date, decimal Quantity, string? Notes);

/// <summary>What to record. Direction says which way they moved; Type keeps crates and sacks apart.</summary>
public record CreateContainerMovementRequest(
    ContainerType Type, ContainerDirection Direction, DateTimeOffset Date, decimal Quantity, string? Notes);

/// <summary>
/// One kind of container's standing with one person.
///
/// FromInvoices is only ever non-zero for crates against someone acting as a BUYER: a crate leaves
/// with every box-unit line they buy, so that side is derived from their invoices rather than
/// re-typed (and netted against produce sent back, which arrives in its crates). HandedOut and
/// CameBack are what was recorded by hand. Remaining = FromInvoices + HandedOut − CameBack, and a
/// positive number means this person is holding that many of the market's.
///
/// Purely counts. Any money attached to containers is a separate matter and is deliberately kept
/// out of the person's account balance.
/// </summary>
public record ContainerBalanceDto(
    ContainerType Type, decimal FromInvoices, decimal HandedOut, decimal CameBack, decimal Remaining);

/// <summary>Everything the containers page needs for one person: a balance per kind, plus the raw
/// history behind them.</summary>
public record PartnerContainersDto(
    int PartnerId, string PartnerName,
    IReadOnlyList<ContainerBalanceDto> Balances,
    IReadOnlyList<ContainerMovementDto> Movements);
