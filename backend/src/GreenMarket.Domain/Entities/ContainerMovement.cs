using GreenMarket.Domain.Common;
using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One movement of empty containers between the market and a person — crates ("صناديق") or sacks
/// ("مخالات"), counted and never priced. Any money side of this is a separate matter and stays
/// separate: it must never touch the person's account balance, which is about produce.
///
/// This started life as BoxReturn, which recorded only crates, only coming back, and only from
/// buyers. It grew two columns rather than a second table beside it, because a second table for
/// the same idea is how two views of one thing end up disagreeing. Rows written before the change
/// are crates coming back from a buyer, which is exactly what the defaults say they are.
///
/// Who can hold containers: anyone. Sellers and drivers take crates out to fill and bring them
/// back full or empty; buyers take them away with produce and return them empty later.
///
/// A person's balance for one <see cref="ContainerType"/> is Out minus In — positive means they
/// are holding that many of the market's. For a BUYER'S crates the Out side also counts the
/// box-unit lines on their own invoices, since a crate physically leaves with every one of them;
/// see PartnerService. Everything else is recorded here by hand.
/// </summary>
public class ContainerMovement : AuditableEntity
{
    public int PartnerId { get; set; }
    public Partner Partner { get; set; } = null!;

    /// <summary>Crates and sacks are tracked apart — see ContainerType.</summary>
    public ContainerType Type { get; set; }

    /// <summary>Out = the market handed them over; In = they came back.</summary>
    public ContainerDirection Direction { get; set; }

    public DateTimeOffset Date { get; set; }

    /// <summary>Always &gt; 0. A movement recorded wrongly is deleted, not entered again negative —
    /// a negative count would read as the opposite direction and quietly double the correction.</summary>
    public decimal Quantity { get; set; }

    public string? Notes { get; set; }

    public int RecordedByUserId { get; set; }
}
