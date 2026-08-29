using GreenMarket.Domain.Enums;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// One produce line on an invoice (requirement doc §4): item name, a quantity in
/// whatever unit that item is actually sold in (kg, box, ...), a price per unit in
/// shekels, and the computed line total. Not every item is sold by weight — a "box"
/// of produce is just as common at the market as a kg price — so the unit is stored
/// per line rather than assumed to always be kg.
/// </summary>
public class InvoiceItem
{
    public int Id { get; set; }

    public int InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;

    public string ItemName { get; set; } = string.Empty;
    public decimal Quantity { get; set; }
    public UnitOfMeasure Unit { get; set; } = UnitOfMeasure.Kg;
    public decimal PricePerUnit { get; set; }

    /// <summary>= Quantity * PricePerUnit, kept as a stored column (not computed-in-SQL) so historical
    /// invoices remain correct even if rounding rules change later.</summary>
    public decimal LineTotal { get; set; }
}
