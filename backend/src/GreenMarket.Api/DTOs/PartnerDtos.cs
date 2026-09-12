using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>OpeningBalance ("الرصيد الافتتاحي") is a manually-entered starting balance for money
/// already owed to/from this person before this system was in use — see Partner.OpeningBalance's
/// doc comment for the sign convention. Address ("العنوان") is plain optional free text, purely
/// informational — see Partner.Address's doc comment.
///
/// FarmerRemaining/MerchantRemaining ("الرصيد") are populated only by PartnerService.ListAsync (the
/// "الباعة والسواق والمشترين" list page) — the same bulk-aggregated Remaining formula as
/// GetFarmerAccountAsync/GetMerchantAccountAsync/GetDebtsOverviewAsync, one grouped query across the
/// whole page instead of a round trip per row. They're two entirely separate figures, never combined
/// into one number, because a Both partner (farmer+merchant) genuinely has two independent balances —
/// same convention as their two separate "كشف حساب" links. Each is null when it doesn't apply to this
/// partner's Type (e.g. MerchantRemaining is null for a pure Farmer/Driver), and both are null on
/// GetAsync/CreateAsync/UpdateAsync, which don't compute this at all.</summary>
public record PartnerDto(
    int Id, string Name, PartnerType? Type, string? WhatsAppNumber, string? Address, string? Notes,
    decimal? CreditLimit, decimal? OpeningBalance,
    decimal? FarmerRemaining = null, decimal? MerchantRemaining = null);

public record PartnerSuggestionDto(int Id, string Name, PartnerType? Type);

public record CreatePartnerRequest(string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit, string? Address = null, decimal? OpeningBalance = null);

public record UpdatePartnerRequest(string Name, PartnerType? Type, string? WhatsAppNumber, string? Notes, decimal? CreditLimit, string? Address = null, decimal? OpeningBalance = null);

/// <summary>Requirement doc §6: merchant account = invoices, total purchases, paid, remaining.
/// CreditLimit/IsOverCreditLimit mirror the roadmap's "credit limit per merchant" feature — null
/// CreditLimit means no limit is enforced and IsOverCreditLimit is always false in that case.
/// OpeningBalance is the partner's manually-entered starting balance (0/null shown as null here) —
/// already folded INTO Remaining, shown separately too so the statement's numbers are traceable.
///
/// Containers (crates and sacks) are NOT here. They are counts, not currency, they are tracked
/// for sellers and drivers too, and there is now more than one kind of them — so they live on
/// their own screen and their own endpoint (see IContainerService / PartnerContainersDto)
/// instead of riding along on the buyer's money DTO, where sacks and hand-recorded hand-outs
/// would have had nowhere to go.</summary>
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

/// <summary>
/// "قيمة الديون" drill-down: one item line off one of this partner's own Active invoices — the
/// un-aggregated, all-time detail behind that page's per-person amount (requirement: click through
/// and see exactly which invoices/items/quantities/prices make up the number). No date filter, same
/// convention as PartnerDebtRow.Remaining itself being an all-time running total.
///
/// TransportFee/GrandTotal are INVOICE-level figures, never per item — repeated identically across
/// every one of that invoice's own item rows (an invoice can have more than one item line). Read
/// them once per invoice (e.g. from that invoice's first row), never sum them across item rows, or
/// a multi-item invoice's transport fee/grand total would be counted more than once — same
/// convention as DriverItemBreakdownRow.TotalTransportFee.
/// </summary>
public record PartnerInvoiceItemLineDto(
    int InvoiceId, string InvoiceNumber, DateTimeOffset Date,
    string ItemName, decimal Quantity, decimal? WeightKg, decimal PricePerUnit, decimal WoodPrice, decimal LineTotal,
    decimal TransportFee, decimal GrandTotal);

/// <summary>Wraps the itemized lines above with the partner's own id/name — see
/// PartnerService.GetFarmerInvoiceDetailAsync (بائع/سائق side, matched by Invoice.FarmerId or
/// Invoice.DriverId depending on partner Type — same page-sharing convention as
/// GetFarmerAccountAsync) and GetMerchantInvoiceDetailAsync (مشتري side, Invoice.MerchantId).</summary>
public record PartnerInvoiceDetailDto(int PartnerId, string PartnerName, IReadOnlyList<PartnerInvoiceItemLineDto> Lines);

/// <summary>
/// A manual "تسوية/تعويض" line on a seller's or driver's account (see
/// PartnerService.CreateAdjustmentAsync).
///
/// Amount is SIGNED and that sign is the whole point: positive means the market owes this person
/// more (the case this was built for — compensating a seller when an item's price collapsed in the
/// market after he brought it in), negative means it owes them less. Reason is required, because a
/// balance that moved with no invoice and no payment behind it has to explain itself on the
/// statement, where this shows up as its own line.
/// </summary>
public record CreateAdjustmentRequest(decimal Amount, string Reason);

/// <summary>The line that was posted, echoed back so the caller can show it without re-fetching
/// the whole statement.</summary>
public record AdjustmentDto(int Id, int PartnerId, DateTimeOffset Date, decimal Amount, string Reason);
