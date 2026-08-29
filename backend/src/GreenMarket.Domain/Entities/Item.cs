namespace GreenMarket.Domain.Entities;

/// <summary>
/// A produce/goods name the market has seen before (e.g. "بندورة", "خيار"). This is a simple
/// growing catalog, not a rigid product list: any name can still be typed fresh on an invoice
/// line, and a name that hasn't been seen before is added here automatically when the invoice
/// is saved (see InvoiceService.CreateAsync) — exactly the same "type it once, pick it from a
/// list every time after" pattern already used for Partners.
/// </summary>
public class Item
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
