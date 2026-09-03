using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One "goods intake" record: a farmer/seller physically brought in some quantity of an item
/// (weighed in Kg or counted in boxes), logged here BEFORE any of it is sold. This is what makes
/// "بضاعة الباعة" a real stock feature instead of a pure sales report — GoodsService computes each
/// farmer/item/unit's currently-available quantity as (sum of these entries' Quantity) minus (sum
/// of that same farmer's own Active invoice items for the same ItemName+Unit — see
/// GoodsService.GetForFarmerAsync), the same "derive it live from the source of truth" approach
/// InvoiceService.GetFarmerGoodsAsync/Reports already use, rather than maintaining a separate
/// mutable running-balance column that could drift. That also means an edited or cancelled
/// invoice's effect on "available" corrects itself automatically the moment it's recomputed — no
/// reversal bookkeeping needed here, unlike the money ledger (FarmerTransaction).
///
/// WoodQuantity mirrors FarmerGoodsRow's WoodQuantity — the portion of Quantity that came in wood
/// crates, purely informational (never subtracted from anything on its own).
///
/// Like Partner.CreditLimit, going negative (sold more than was ever logged as received) is never
/// blocked — it's shown as a warning on the page so staff can fix a missed/incomplete "add goods"
/// entry, not something that can stop a sale from being recorded.
/// </summary>
public class FarmerGoodsEntry : AuditableEntity
{
    public int FarmerId { get; set; }
    public Partner Farmer { get; set; } = null!;

    public DateTimeOffset Date { get; set; }
    public string ItemName { get; set; } = string.Empty;
    public UnitOfMeasure Unit { get; set; } = UnitOfMeasure.Kg;
    public decimal Quantity { get; set; }

    /// <summary>Portion of <see cref="Quantity"/> delivered in wood crates — see the class doc comment.</summary>
    public decimal WoodQuantity { get; set; }

    public string? Notes { get; set; }
}
