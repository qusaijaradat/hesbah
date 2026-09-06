using System.Linq.Expressions;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Services;

/// <summary>
/// The one rule that decides whether a recorded payment counts as money actually moved.
///
/// Explicit requirement: "الشيك لا يُحسب مع الدفعات إلا عند تحوّل حالته إلى تم الصرف، بجميع
/// الصفحات اللي بتحسب." A check written today against an invoice is a promise, not cash — until
/// the bank actually pays it, the merchant still owes the money and the farmer/driver hasn't been
/// paid. So a check counts ONLY once its <see cref="CheckClearanceStatus"/> is
/// <see cref="CheckClearanceStatus.Cleared"/>:
///
///   • not a check at all (CheckStatus is null — نقدي/حوالة/أخرى) → counts immediately
///   • Pending  → does NOT count (previously it did, which understated every balance the moment a
///                check was recorded)
///   • Cleared  → counts
///   • Bounced  → does NOT count
///
/// It lives here, in one place, because eight separate queries across PartnerService,
/// InvoiceService, ReportService and PaymentService each used to spell out their own
/// "!= Bounced" version of this — exactly the kind of duplicated predicate that drifts the next
/// time the rule changes. Every balance/total in the app now goes through this instead.
///
/// A check that hasn't cleared is never hidden — it still appears on the Checks page, the Payments
/// list and the account statement (shown at 0 with a note saying why), so it's visibly recorded
/// and pending rather than missing.
/// </summary>
public static class PaymentRules
{
    /// <summary>In-memory form, for code that already has the rows materialized.</summary>
    public static bool CountsTowardBalance(CheckClearanceStatus? checkStatus) =>
        checkStatus is null or CheckClearanceStatus.Cleared;

    /// <summary>
    /// EF-translatable form of <see cref="CountsTowardBalance(CheckClearanceStatus?)"/>, for
    /// filtering a Payments query server-side. Kept as a separate expression (rather than calling
    /// the method above inside a lambda) because EF Core can only translate the expression tree,
    /// not an arbitrary method call — pass it straight to <c>.Where(...)</c>.
    /// </summary>
    public static readonly Expression<Func<Payment, bool>> CountsTowardBalanceExpression =
        p => p.CheckStatus == null || p.CheckStatus == CheckClearanceStatus.Cleared;
}
