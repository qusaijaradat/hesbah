using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Services;

/// <summary>
/// Which of a person's accounts a "تسوية" lands on.
///
/// The market writes an amount straight onto somebody's account — money settled outside the
/// system, a rounding somebody agreed to, a balance being cleared by hand. It is not a sale, not a
/// cash payment and not a correction to any one invoice; it is the market saying "this much is
/// dealt with" and wanting it on the statement, in words, when that statement is printed.
///
/// The same man often has two accounts: he brings produce in the morning and buys a crate of
/// something else in the afternoon. This used to be handled by a "مقاصّة" screen that made you
/// pick the person, showed both balances, computed the most that could be netted and refused
/// anything larger. It was correct and nobody used it, because settling a balance in a market is a
/// sentence ("خلص، صافينا") and the screen made it a procedure.
///
/// So: no limits, no confirmation, no picking. One amount, on whichever accounts the person
/// actually has — and that last part is the only rule left worth writing down, because getting it
/// wrong means either a credit appearing on an account the person does not have, or half a
/// settlement landing while the other half quietly does not.
/// </summary>
public static class SettlementSides
{
    /// <summary>
    /// Does this person have a seller/driver account for it to land on?
    ///
    /// An unknown role counts as yes. Staff record a person before knowing what they are, and the
    /// seller ledger is the only place a hand-written line can live at all — a buyer's balance is
    /// computed from his invoices and payments, so it has no row to receive one. Landing nowhere
    /// is the one outcome that must not happen: the market typed an amount and pressed save.
    /// </summary>
    public static bool TouchesSeller(PartnerType? type) =>
        type is null || PartnerRoles.HasSellerSide(type);

    /// <summary>Does this person buy? Only then does the amount come off what he owes.</summary>
    public static bool TouchesBuyer(PartnerType? type) =>
        type is not null && PartnerRoles.Has(type, PartnerType.Merchant);
}
