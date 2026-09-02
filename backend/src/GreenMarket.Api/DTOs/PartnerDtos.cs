using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>OpeningBalance ("الرصيد الافتتاحي") is a manually-entered starting balance for money
/// already owed to/from this person before this system was in use — see Partner.OpeningBalance's
/// doc comment for the sign convention. Address ("العنوان") is plain optional free text, purely
/// informational — see Partner.Address's doc comment.</summary>
public record PartnerDto(int Id, string Name, PartnerType? Type, string? WhatsAppNumber, string? Address, string? Notes, decimal? CreditLimit, decimal? OpeningBalance);

public record PartnerSuggestionDto(int Id, string Name, PartnerType? Type);

public record CreatePartnerRequest(string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit, string? Address = null, decimal? OpeningBalance = null);

public record UpdatePartnerRequest(string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit, string? Address = null, decimal? OpeningBalance = null);

/// <summary>Requirement doc §6: merchant account = invoices, total purchases, paid, remaining.
/// CreditLimit/IsOverCreditLimit mirror the roadmap's "credit limit per merchant" feature — null
/// CreditLimit means no limit is enforced and IsOverCreditLimit is always false in that case.
/// OpeningBalance is the partner's manually-entered starting balance (0/null shown as null here) —
/// already folded INTO Remaining, shown separately too so the statement's numbers are traceable.</summary>
public record MerchantAccountDto(
    int PartnerId, string Name,
    decimal TotalPurchases, decimal TotalPaid, decimal Remaining,
    decimal? CreditLimit, bool IsOverCreditLimit, decimal? OpeningBalance,
    IReadOnlyList<StatementLineDto> Statement);

/// <summary>Requirement doc §6: farmer/driver account = value sold or transport fees earned,
/// commission, due, paid, remaining. TotalNetDue includes both Sale rows (farmer) and TransportFee
/// rows (driver) — see FarmerTransactionType.TransportFee; a pure driver simply has TotalSalesValue/
/// TotalCommission always 0. OpeningBalance mirrors MerchantAccountDto's — already folded into
/// Remaining, shown separately for traceability. Type lets the page title say "بائع" or "سائق"
/// specifically instead of a generic "بائع/سائق" for everyone (a Both partner is never a driver,
/// so their farmer-side page always reads "بائع").</summary>
public record FarmerAccountDto(
    int PartnerId, string Name, PartnerType? Type,
    decimal TotalSalesValue, decimal TotalCommission, decimal TotalNetDue, decimal TotalPaid, decimal Remaining,
    decimal? OpeningBalance,
    IReadOnlyList<StatementLineDto> Statement);

/// <summary>Requirement: "الكشف يكون مفصل بالضبط شو هو" — every optional field here is populated
/// when relevant to THIS line's kind and left null otherwise: InvoiceId/InvoiceNumber link back to
/// the actual invoice (merchant invoice lines, and farmer/driver Sale/TransportFee/Adjustment lines);
/// SaleValue/Commission break down a farmer's Sale line into gross value vs. the market's cut (the
/// line's own Amount is SaleValue - Commission = the farmer's net due); Method/Notes carry a
/// payment's recorded method and free-text notes (merchant AND farmer/driver payment lines).</summary>
public record StatementLineDto(
    DateTimeOffset Date, string Description, decimal Amount, decimal RunningBalance,
    int? InvoiceId, string? InvoiceNumber,
    decimal? SaleValue, decimal? Commission,
    string? Method, string? Notes);

/// <summary>One row on the "قيمة الدين" overview page — same Remaining figure and sign convention
/// as MerchantAccountDto.Remaining / FarmerAccountDto.Remaining for this partner (opening balance
/// already folded in). Rows with Remaining == 0 are filtered out before this reaches the client.</summary>
public record PartnerDebtRow(int PartnerId, string Name, decimal Remaining);

/// <summary>Requirement: a single page with 3 sections (بائع/سائق/مشتري) listing everyone who
/// currently has a non-zero balance. A partner of type Both appears in BOTH Farmers (their farmer-side
/// ledger) and Merchants (their merchant-side ledger) with their own independent Remaining in each —
/// same convention as the two separate "كشف حساب" links already shown for a Both partner.</summary>
public record DebtsOverviewDto(
    IReadOnlyList<PartnerDebtRow> Farmers,
    IReadOnlyList<PartnerDebtRow> Drivers,
    IReadOnlyList<PartnerDebtRow> Merchants);
