// Prints the SQL EF Core generates for queries worth being sure about, without a database:
// ToQueryString only needs the model, not a connection. Added because a LINQ query that cannot be
// translated compiles perfectly and then throws at runtime, on the one code path that matters.
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseNpgsql("Host=localhost;Database=none;Username=none;Password=none")
    .Options;
using var db = new AppDbContext(options);

Show("returns of one invoice, with their lines (InvoiceService.UpdateAsync guard)",
    db.GoodsReturns.Include(r => r.Items).Where(r => r.InvoiceId == 42));

Show("seller Sale rows whose amount no longer matches sale − commission (Program.cs correction)",
    db.FarmerTransactions.Where(t => t.Type == FarmerTransactionType.Sale && t.Amount != t.SaleValue - t.Commission));

Show("find-or-create partner by name, oldest match first (PartnerService)",
    db.Partners.Where(p => p.Name.ToLower() == "أبو عمار").OrderBy(p => p.Id));

Show("returns netted out of one seller's sold quantities (GoodsService per-seller stock)",
    db.GoodsReturns.Where(r => r.Invoice.FarmerId == 9 && r.Invoice.Status == InvoiceStatus.Active)
        .SelectMany(r => r.Items).Select(ri => new { ri.ItemName, ri.Unit, ri.Quantity }));

Show("returns netted out across every seller (GoodsService global stock)",
    db.GoodsReturns.Where(r => r.Invoice.FarmerId != null && r.Invoice.Status == InvoiceStatus.Active)
        .SelectMany(r => r.Items.Select(ri => new { FarmerId = r.Invoice.FarmerId!.Value, ri.ItemName, ri.Unit, ri.Quantity })));

Show("crates coming back with a buyer's returns (PartnerService crate balance)",
    db.GoodsReturns.Where(r => r.Invoice.MerchantId == 7 && r.Invoice.Status == InvoiceStatus.Active)
        .SelectMany(r => r.Items).Where(ri => ri.Unit == UnitOfMeasure.Box).Select(ri => ri.Quantity));

void Show<T>(string label, IQueryable<T> query)
{
    Console.WriteLine($"--- {label}");
    Console.WriteLine(query.ToQueryString());
    Console.WriteLine();
}
