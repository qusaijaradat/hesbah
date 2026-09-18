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
        .SelectMany(r => r.Items).Select(ri => new { ri.ItemName, ri.Quantity, ri.WeightKg }));

Show("returns netted out across every seller (GoodsService global stock)",
    db.GoodsReturns.Where(r => r.Invoice.FarmerId != null && r.Invoice.Status == InvoiceStatus.Active)
        .SelectMany(r => r.Items.Select(ri => new { FarmerId = r.Invoice.FarmerId!.Value, ri.ItemName, ri.Quantity, ri.WeightKg })));

Show("crates coming back with a buyer's returns (PartnerService crate balance)",
    db.GoodsReturns.Where(r => r.Invoice.MerchantId == 7 && r.Invoice.Status == InvoiceStatus.Active)
        .SelectMany(r => r.Items).Select(ri => ri.BoxQuantity));

Show("crates issued per buyer, all buyers at once (ContainerService.GetHoldersAsync)",
    db.Invoices.Where(i => i.Status == InvoiceStatus.Active)
        .SelectMany(i => i.Items.Select(it => new { i.MerchantId, it.BoxQuantity, it.CartonQuantity }))
        .GroupBy(x => x.MerchantId)
        .Select(g => new { PartnerId = g.Key, Boxes = g.Sum(x => x.BoxQuantity), Cartons = g.Sum(x => x.CartonQuantity) }));

Show("hand-recorded container movements per person and kind (GetHoldersAsync)",
    db.ContainerMovements.GroupBy(m => new { m.PartnerId, m.Type, m.Direction })
        .Select(g => new { g.Key.PartnerId, g.Key.Type, g.Key.Direction, Total = g.Sum(m => m.Quantity) }));

// Role membership is a BITWISE test now that a person can hold more than one role (PartnerRoles).
// Worth printing: if EF cannot translate the & it does not fail here, it silently pulls the whole
// partners table into memory — on the query behind every name picker in the app.
var wantsDriver = true;
var wantsMerchant = false;
Show("name suggestions restricted to a ROLE, not an exact type (PartnerService.SuggestAsync)",
    db.Partners.Where(p => p.Name.Contains("خالد")).Where(p => p.Type != null && (
        (wantsMerchant && (p.Type.Value & PartnerType.Merchant) == PartnerType.Merchant) ||
        (wantsDriver && (p.Type.Value & PartnerType.Driver) == PartnerType.Driver))));

Show("partners list filtered by a role (PartnerService.ListAsync)",
    db.Partners.Where(p => p.Type != null && (p.Type.Value & PartnerType.Driver) == PartnerType.Driver));

// The Sale rows a seller EARNED, which since the produce money started following the driver is no
// longer the same set as the Sale rows that SIT on him. Grouping by a value reached through a
// navigation is the part worth printing: if EF cannot translate it, the report quietly pulls every
// ledger row in the system into memory to add up one column.
Show("commission counted against the seller whose produce earned it (ReportService.FarmerReportAsync)",
    db.FarmerTransactions
        .Where(t => t.Type == FarmerTransactionType.Sale && t.Invoice != null && t.Invoice.FarmerId != null)
        .GroupBy(t => t.Invoice!.FarmerId!.Value)
        .Select(g => new { FarmerId = g.Key, Commission = g.Sum(t => t.Commission) }));

// The invoices behind the item detail printed under a كشف حساب.
//
// This is the query AFTER a fix this tool paid for itself with. Flattening the items with a
// translated SelectMany and then ordering by a column of the projected record is refused by EF at
// RUNTIME — it compiles perfectly — so the first person to print a statement would have got an
// exception. The lines are flattened in memory now; this prints what actually goes to the database.
Show("invoices behind a printed account statement’s item detail (PartnerService.GetStatementDetailAsync)",
    db.Invoices
        .Where(i => i.MerchantId == 7 && i.Status == InvoiceStatus.Active)
        .Include(i => i.Items)
        .OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber));

// And the driver half: whose produce he carried, with the crate fee — an invoice-level rate times a
// per-item count, which is why it is computed here and grouped afterwards rather than in SQL.
Show("a driver’s sellers under his statement (PartnerService.GetStatementDetailAsync)",
    db.Invoices
        .Where(i => i.DriverId == 11 && i.Status == InvoiceStatus.Active)
        .Select(i => new
        {
            SellerName = i.Farmer != null ? i.Farmer.Name : null,
            i.TransportFee,
            BoxFee = i.Items.Sum(it => it.BoxQuantity) * i.DriverBoxFeeApplied,
            Boxes = i.Items.Sum(it => it.BoxQuantity)
        }));

void Show<T>(string label, IQueryable<T> query)
{
    Console.WriteLine($"--- {label}");
    Console.WriteLine(query.ToQueryString());
    Console.WriteLine();
}
