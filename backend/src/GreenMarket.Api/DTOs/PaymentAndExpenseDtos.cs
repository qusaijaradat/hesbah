using GreenMarket.Domain.Enums;

namespace GreenMarket.Api.DTOs;

/// <summary>
/// PartnerId is optional: if omitted, PartnerName is resolved the same way as on invoices —
/// an existing partner by name (case-insensitive) or a brand new one created on the fly.
/// Exactly one of {PartnerId, PartnerName} must be supplied. InvoiceId is optional (roadmap:
/// "link a payment to a specific invoice") — when supplied, the invoice must belong to this
/// same partner; when omitted the payment just reduces the partner's aggregate balance as before.
/// CheckDueDate/CheckNumber are only meaningful when Method is a check ("شيك") — recording several
/// Payment rows against the same invoice (one plain, one with these set) is how one invoice ends up
/// settled with more than one payment method at once (e.g. part cash, part checks). A new check
/// always starts at CheckClearanceStatus.Pending — see PaymentService.CreateAsync.
/// </summary>
public record CreatePaymentRequest(int? PartnerId, string? PartnerName, PaymentDirection Direction, decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId = null, DateTimeOffset? CheckDueDate = null, string? CheckNumber = null);

/// <summary>Editing a payment can change amount/date/method/notes/the linked invoice, but never
/// the partner or direction — that would mean redoing which ledger it posted to from scratch,
/// which is safer done as a delete-and-recreate if it's ever really needed. CheckStatus is included
/// here (but not on CreatePaymentRequest) specifically so the "الشيكات" page can flip a check to
/// Cleared/Bounced without touching anything else about the payment.</summary>
public record UpdatePaymentRequest(decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId = null, DateTimeOffset? CheckDueDate = null, string? CheckNumber = null, CheckClearanceStatus? CheckStatus = null, DateTimeOffset? CheckClearedDate = null);

public record PaymentDto(int Id, int PartnerId, string PartnerName, PaymentDirection Direction, decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId, string? InvoiceNumber, DateTimeOffset? CheckDueDate, string? CheckNumber, CheckClearanceStatus? CheckStatus, DateTimeOffset? CheckClearedDate);

/// <summary>EmployeeId optionally attributes this expense (or withdrawal — see Employee.cs) to a
/// specific employee; null means it isn't tied to anyone, same as before this field existed.</summary>
public record CreateExpenseRequest(DateTimeOffset Date, string Description, decimal Amount, string? Category, int? EmployeeId = null);

public record UpdateExpenseRequest(DateTimeOffset Date, string Description, decimal Amount, string? Category, int? EmployeeId = null);

public record ExpenseDto(int Id, DateTimeOffset Date, string Description, decimal Amount, string? Category, int? EmployeeId, string? EmployeeName);
