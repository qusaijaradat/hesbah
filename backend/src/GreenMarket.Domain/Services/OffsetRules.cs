namespace GreenMarket.Domain.Services;

/// <summary>
/// "مقاصّة" — settling what somebody owes the market as a BUYER against what the market owes them
/// as a SELLER.
///
/// The same man brings produce in the morning and buys a crate of something else in the afternoon;
/// the market has always had people who are both. Until now those were two accounts that never
/// met: the market handed him cash for his produce and then collected cash back for his purchases,
/// and the two sides of the same person settled in opposite directions on the same day.
///
/// This is the rule for netting them. It is not a new kind of money and it does not change how
/// either balance is computed — an offset is recorded as two ordinary payments, one on each side,
/// so every statement, report and total goes on reading exactly what it always read. What lives
/// here is only the question of HOW MUCH may be settled, which is the part that can be got wrong
/// quietly.
/// </summary>
public static class OffsetRules
{
    /// <summary>
    /// The most that can be settled between the two sides.
    ///
    /// The smaller of the two, and never below zero. Settling more than the market owes him would
    /// be recording a payment it never made — leaving him owing the market as a SELLER, a debt
    /// that came from nothing and that nobody could explain a week later. Settling more than he
    /// owes as a buyer does the mirror of it.
    /// </summary>
    /// <param name="buyerOwes">His merchant account's remaining. Positive means he owes it.</param>
    /// <param name="marketOwesSeller">His seller/driver account's remaining. Positive means the
    /// market owes him.</param>
    public static decimal Maximum(decimal buyerOwes, decimal marketOwesSeller) =>
        Math.Min(Math.Max(0m, buyerOwes), Math.Max(0m, marketOwesSeller));

    /// <summary>
    /// Is this amount settleable? Above zero and no more than <see cref="Maximum"/>.
    ///
    /// Refused rather than clamped: an amount somebody typed is an amount they meant, and silently
    /// settling less than was asked for is how two people end the day believing different numbers.
    /// </summary>
    public static bool IsAllowed(decimal amount, decimal buyerOwes, decimal marketOwesSeller) =>
        amount > 0m && amount <= Maximum(buyerOwes, marketOwesSeller);
}
