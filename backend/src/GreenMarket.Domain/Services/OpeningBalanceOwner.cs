using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Services;

/// <summary>
/// Which of a person's two accounts his "الرصيد الافتتاحي" belongs to.
///
/// It is ONE figure for ONE person — what was owed between him and the market before this system
/// existed — and the market says so: "الرصيد الافتتاحي بيمثل حساب واحد لنفس الشخص، سواء عليه دين
/// أو إلنا دين عليه". One figure, counted once.
///
/// It used to be added to BOTH: a man who sells and also buys had his old balance counted on his
/// seller account AND on his buyer account, so the market saw the same 500 twice and, on the sheet
/// that nets the two, saw it cancel itself out. Three readings of one number, none of them the
/// number.
///
/// The side it lands on is the one whose sign convention the figure was entered under, and that is
/// the person's own: for a seller or a driver, positive means the market already owed HIM; for a
/// buyer, positive means he already owed the market. A person who is both keeps it on his seller
/// side — the ledger his balance actually lives in — and his buyer sheet says where it went rather
/// than counting it again.
/// </summary>
public static class OpeningBalanceOwner
{
    /// <summary>
    /// True when the opening balance counts on the seller/driver account.
    ///
    /// Also true when the role is not recorded yet: staff enter a person before knowing what he is,
    /// and the seller ledger is the only account that can hold a line at all — a buyer's balance is
    /// computed from his invoices and payments, so a figure landing nowhere would simply vanish.
    /// </summary>
    public static bool OnSellerSide(PartnerType? type) =>
        type is null || PartnerRoles.HasSellerSide(type);

    /// <summary>True when it counts on the buyer account — which is to say, when he only buys.</summary>
    public static bool OnBuyerSide(PartnerType? type) => !OnSellerSide(type);
}
