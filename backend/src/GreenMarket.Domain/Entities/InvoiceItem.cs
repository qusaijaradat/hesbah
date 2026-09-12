using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One produce line on an invoice (requirement doc §4).
///
/// A line carries FOUR counts, and they are four different things — the shape this grew into
/// after a line could only be "a quantity in a unit", either kg or boxes, never both:
///
///   • <see cref="Quantity"/> — العدد. Always entered, on every line.
///   • <see cref="WeightKg"/> — الوزن. Optional. Its presence is what decides how the line is
///     priced (see <see cref="LineTotal"/>); it does not need a separate "unit" to say so.
///   • <see cref="BoxQuantity"/> — عدد الصناديق, the crates that physically went out with this
///     line. The ONLY count رسوم الصناديق and the driver's أجرة الصناديق are charged on.
///   • <see cref="CartonQuantity"/> — عدد الكرتون. Counted and tracked, never charged for.
///
/// The old Kg/Box unit could not express a line that is priced by weight AND went out in twelve
/// crates, which is most of them: the crates on such a line counted as zero everywhere — no
/// crate fee, nothing owed to the driver for handling them, and nothing on the containers screen
/// saying the buyer was holding them.
/// </summary>
public class InvoiceItem
{
    public int Id { get; set; }

    public int InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    public string ItemName { get; set; } = string.Empty;

    /// <summary>"العدد" — required on every line. Prices the line when no weight is given.</summary>
    public decimal Quantity { get; set; }

    /// <summary>
    /// "الوزن" in kilograms, or null when this line is not weighed. Null and 0 mean the same thing
    /// here (priced by العدد) — nullable only so an old line that never had a weight is visibly
    /// different from one weighed at zero.
    /// </summary>
    public decimal? WeightKg { get; set; }

    /// <summary>"عدد الصناديق" — crates out with this line. Charged (رسوم الصناديق) and tracked.</summary>
    public decimal BoxQuantity { get; set; }

    /// <summary>"عدد الكرتون" — cartons out with this line. Tracked, never charged.</summary>
    public decimal CartonQuantity { get; set; }

    /// <summary>Per كيلو when <see cref="WeightKg"/> is set, otherwise per واحد of العدد.</summary>
    public decimal PricePerUnit { get; set; }

    /// <summary>
    /// Optional per-line wood/crate cost ("سعر الخشب") — a flat add-on for this line (not
    /// multiplied by Quantity), one of a small fixed set of preset values (3/5/6/7/8), 0 when left
    /// unset. Deliberately excluded from LineTotal/PricePerUnit math for the same reason as
    /// Invoice.TransportFee: it must never inflate the commission base.
    /// </summary>
    public decimal WoodPrice { get; set; }

    /// <summary>
    /// = الوزن × السعر when a weight is given, otherwise العدد × السعر. Stored (not computed in
    /// SQL) so historical invoices stay correct even if the rule or the rounding changes later.
    /// <see cref="Services.InvoiceCalculator.LineTotalFor"/> is the one place that decides it.
    /// </summary>
    public decimal LineTotal { get; set; }
}
