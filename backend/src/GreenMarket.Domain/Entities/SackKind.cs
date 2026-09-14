using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One kind of sack ("مخلاة") — a colour, a shape, a size. "أحمر", "أصفر", "كبير", whatever the
/// market actually distinguishes between when handing them out and getting them back.
///
/// A table rather than an enum, because the market invents these and the market is not going to
/// file a change request to add a colour. The kind picker on the sacks screen creates them, which
/// is the only way a list like this stays true to what is in the yard.
///
/// It exists at all because a sack balance that does not name the kind is unarguable in the wrong
/// direction: somebody takes thirty red and twenty yellow, brings back fifty yellow, and a single
/// count says they are square.
/// </summary>
public class SackKind : AuditableEntity
{
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// A kind the market has stopped using. Kept, never deleted: movements already recorded
    /// against it are facts about sacks somebody is still holding, and a deleted kind would
    /// silently drop them out of every total.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// How many of this kind the market OWNS — the whole lot, whether they are in the store right
    /// now or out with somebody. Typed in once and corrected when the market buys or loses some.
    ///
    /// This is the figure the movements cannot supply. They say how many went out and came back;
    /// only this says how many there were to begin with, and therefore how many are still on the
    /// shelf: owned − outstanding. Without it the sacks screen can answer "who has mine" and not
    /// "how many can I hand out this morning", which is the question asked at the gate.
    /// </summary>
    public decimal StockQuantity { get; set; }
}
