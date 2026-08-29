using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

public record PartnerDto(int Id, string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit);

public record PartnerSuggestionDto(int Id, string Name, PartnerType? Type);

public record CreatePartnerRequest(string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit);

public record UpdatePartnerRequest(string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit);

/// <summary>Requirement doc §6: merchant account = invoices, total purchases, paid, remaining.
/// CreditLimit/IsOverCreditLimit mirror the roadmap's "credit limit per merchant" feature — null
/// CreditLimit means no limit is enforced and IsOverCreditLimit is always false in that case.</summary>
public record MerchantAccountDto(
    int PartnerId, string Name,
    decimal TotalPurchases, decimal TotalPaid, decimal Remaining,
    decimal? CreditLimit, bool IsOverCreditLimit,
    IReadOnlyList<StatementLineDto> Statement);

/// <summary>Requirement doc §6: farmer account = value sold, commission, due, paid, remaining.</summary>
public record FarmerAccountDto(
    int PartnerId, string Name,
    decimal TotalSalesValue, decimal TotalCommission, decimal TotalNetDue, decimal TotalPaid, decimal Remaining,
    IReadOnlyList<StatementLineDto> Statement);

public record StatementLineDto(DateTimeOffset Date, string Description, decimal Amount, decimal RunningBalance);
