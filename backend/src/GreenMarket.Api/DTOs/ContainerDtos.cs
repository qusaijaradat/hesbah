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
/// Two of the four are derived rather than re-typed, because the market already records them
/// elsewhere and typing them twice is both work and a way to disagree with itself:
///
///   • FromInvoices — crates going OUT with a buyer. One leaves with every box-unit line they
///     buy, net of produce sent back, which arrives in its crates. Buyers only.
///   • FromGoodsEntries — wooden crates coming IN with a seller's produce, counted on the
///     "إضافة بضاعة" form (FarmerGoodsEntry.WoodQuantity). Sellers only.
///
/// HandedOut and CameBack are what was recorded by hand on the containers screen.
///
/// Remaining = (FromInvoices + HandedOut) − (CameBack + FromGoodsEntries). POSITIVE means this
/// person is holding that many of the market's; NEGATIVE means the market is holding theirs,
/// which is the normal state for a seller who keeps bringing his produce in his own crates.
///
/// Purely counts. Any money attached to containers is a separate matter and is deliberately kept
/// out of the person's account balance.
/// </summary>
public record ContainerBalanceDto(
    ContainerType Type, decimal FromInvoices, decimal FromGoodsEntries,
    decimal HandedOut, decimal CameBack, decimal Remaining);

/// <summary>
/// One line of "مين ماسك صناديقي" — a person and one kind of container they are not square on.
/// Remaining carries the same sign as ContainerBalanceDto: positive means they hold that many of
/// the market's, negative means the market holds theirs.
/// </summary>
public record ContainerHolderDto(int PartnerId, string PartnerName, ContainerType Type, decimal Remaining);

/// <summary>Everything the containers page needs for one person: a balance per kind, plus the raw
/// history behind them.</summary>
public record PartnerContainersDto(
    int PartnerId, string PartnerName,
    IReadOnlyList<ContainerBalanceDto> Balances,
    IReadOnlyList<ContainerMovementDto> Movements);
