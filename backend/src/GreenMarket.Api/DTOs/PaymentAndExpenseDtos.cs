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

/// <param name="OffsetGroupId">Set on both halves of a مقاصّة — see Payment.OffsetGroupId. The
/// screens use it to say that this row moved no cash, and the delete uses it to take the pair.</param>
public record PaymentDto(int Id, int PartnerId, string PartnerName, PaymentDirection Direction, decimal Amount, DateTimeOffset Date, string? Method, string? Notes, int? InvoiceId, string? InvoiceNumber, DateTimeOffset? CheckDueDate, string? CheckNumber, CheckClearanceStatus? CheckStatus, DateTimeOffset? CheckClearedDate, Guid? OffsetGroupId);

/// <summary>EmployeeId optionally attributes this expense (or withdrawal — see Employee.cs) to a
/// specific employee; null means it isn't tied to anyone, same as before this field existed.</summary>
public record CreateExpenseRequest(DateTimeOffset Date, string Description, decimal Amount, string? Category, int? EmployeeId = null);

public record UpdateExpenseRequest(DateTimeOffset Date, string Description, decimal Amount, string? Category, int? EmployeeId = null);

public record ExpenseDto(int Id, DateTimeOffset Date, string Description, decimal Amount, string? Category, int? EmployeeId, string? EmployeeName);

/// <summary>
/// Both sides of one person, and how much of the two can be settled against each other.
///
/// Read straight off the same two account pages the app already shows (PartnerService's
/// GetMerchantAccountAsync / GetFarmerAccountAsync), never recomputed — a third place that
/// works out what somebody owes is a third place for it to be wrong.
/// </summary>
/// <param name="BuyerOwes">His merchant balance. Positive means he owes the market.</param>
/// <param name="MarketOwesSeller">His seller/driver balance. Positive means the market owes him.</param>
/// <remarks>There is no "most that can be settled" any more. The screen that computed one, and
/// refused anything larger, is gone — see Domain.Services.SettlementSides.</remarks>
public record PartnerBalancesDto(
    int PartnerId, string PartnerName, decimal BuyerOwes, decimal MarketOwesSeller);

/// <summary>
/// One "تسوية": an amount written straight onto somebody's account.
///
/// It becomes an ordinary payment on each account the person actually has — both, for the man
/// who sells in the morning and buys in the afternoon — of the same amount, on the same date,
/// sharing an OffsetGroupId so the pair is found again on delete. No cash moves.
/// </summary>
/// <param name="Notes">Why, in the market's own words. Optional, and it is what the line SAYS on
/// the printed statement, so leaving it blank falls back to a plain "تسوية على الحساب".</param>
public record CreateSettlementRequest(int PartnerId, decimal Amount, DateTimeOffset Date, string? Notes);
