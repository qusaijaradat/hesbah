using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>
/// PartnerId is optional: if omitted, PartnerName is resolved the same way as on invoices —
/// an existing partner by name (case-insensitive) or a brand new one created on the fly.
/// Exactly one of {PartnerId, PartnerName} must be supplied. InvoiceId is optional (roadmap:
/// "link a payment to a specific invoice") — when supplied, the invoice must belong to this
/// same partner; when omitted the payment just reduces the partner's aggregate balance as before.
/// </summary>
public record CreatePaymentRequest(int? PartnerId, string? PartnerName, PaymentDirection Direction, decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId = null);

/// <summary>Editing a payment can change amount/date/method/notes/the linked invoice, but never
/// the partner or direction — that would mean redoing which ledger it posted to from scratch,
/// which is safer done as a delete-and-recreate if it's ever really needed.</summary>
public record UpdatePaymentRequest(decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId = null);

public record PaymentDto(int Id, int PartnerId, string PartnerName, PaymentDirection Direction, decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId, string? InvoiceNumber);

public record CreateExpenseRequest(DateTimeOffset Date, string Description, decimal Amount, string? Category);

public record UpdateExpenseRequest(DateTimeOffset Date, string Description, decimal Amount, string? Category);

public record ExpenseDto(int Id, DateTimeOffset Date, string Description, decimal Amount, string? Category);
