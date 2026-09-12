using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// "بضاعة الباعة" goods-stock intake: staff log what a farmer physically brought in (see
/// FarmerGoodsEntry), and this nets those entries against that farmer's own actual invoice sales
/// to show what's still available — see FarmerGoodsEntry's doc comment for why this is computed
/// live from Invoices rather than kept as a separately-maintained running balance.
/// </summary>
public interface IGoodsService
{
    Task<FarmerGoodsStockDto> GetForFarmerAsync(int farmerId);

    /// <summary>Same "received minus sold, live, all-time" computation as GetForFarmerAsync's Stock
    /// list, but summed across EVERY farmer at once — one row per item+unit, used by the
    /// "البضاعة المتوفرة حاليًا" section shown at the end of both "بضاعة الباعة" and "الإغلاق
    /// اليومي" (each page reaches it through its own controller/permission — see
    /// GoodsController.GlobalStock / ReportsController.GoodsGlobalStock).</summary>
    Task<IReadOnlyList<GoodsStockRow>> GetGlobalStockAsync();
    Task<GoodsEntryDto> CreateAsync(CreateGoodsEntryRequest request, int recordedByUserId);
    Task<GoodsEntryDto> UpdateAsync(int id, UpdateGoodsEntryRequest request);
    Task DeleteAsync(int id);
}

public class GoodsService : IGoodsService
{
    private readonly AppDbContext _db;
    private readonly IItemService _items;

    public GoodsService(AppDbContext db, IItemService items)
    {
        _db = db;
        _items = items;
    }

    /// <summary>
    /// Entries: this farmer's own intake log, newest first. Stock: one row per item+unit that
    /// appears in EITHER the intake log OR the farmer's own Active invoice items (an item sold
    /// with zero logged intake still needs to show up, deeply negative, so a missed "إضافة بضاعة"
    /// entry is visible rather than silently absent) — matched by ItemName trimmed + case-
    /// insensitive, same loose-text convention GetFarmerGoodsAsync/MerchantItemBreakdownAsync
    /// already group by, since invoice items are free text, not a foreign key to the Items catalog.
    /// </summary>
    public async Task<FarmerGoodsStockDto> GetForFarmerAsync(int farmerId)
    {
        var farmer = await _db.Partners.FindAsync(farmerId) ?? throw new NotFoundAppException("Partner (farmer)", farmerId);

        var entries = await _db.FarmerGoodsEntries
            .Where(e => e.FarmerId == farmerId)
            .OrderByDescending(e => e.Date).ThenByDescending(e => e.Id)
            .ToListAsync();

        // Keyed on the item NAME alone. It used to include the Kg/Box unit, which was the only thing
        // saying whether a number was a weight or a count — now every line carries both, so the two
        // are netted side by side and an item can no longer split into two unrelated rows because it
        // was taken in by weight and sold by the crate.
        //
        // Wood and sacks are summed here too (independent of both — plain container counts, never
        // bounded by or compared against the produce — see GoodsStockRow's doc comment).
        var receivedByKey = entries
            .GroupBy(e => e.ItemName.Trim().ToLowerInvariant())
            .ToDictionary(g => g.Key, g => (
                Display: g.First().ItemName.Trim(),
                Total: g.Sum(e => e.Quantity),
                Weight: g.Sum(e => e.WeightKg ?? 0m),
                Wood: g.Sum(e => e.WoodQuantity),
                Sack: g.Sum(e => e.SackQuantity)));

        // Same "materialize then group in memory" choice as GetFarmerGoodsAsync — only ever this
        // one farmer's Active invoices, so it's cheap and side-steps translating a correlated
        // string-normalization GroupBy key through the Npgsql EF provider.
        var soldLines = await _db.Invoices
            .Where(i => i.FarmerId == farmerId && i.Status == InvoiceStatus.Active)
            .SelectMany(i => i.Items)
            .Select(it => new { it.ItemName, it.Quantity, it.WeightKg })
            .ToListAsync();

        var soldByKey = soldLines
            .GroupBy(l => l.ItemName.Trim().ToLowerInvariant())
            .ToDictionary(g => g.Key, g => (
                Display: g.First().ItemName.Trim(),
                Total: g.Sum(l => l.Quantity),
                Weight: g.Sum(l => l.WeightKg ?? 0m)));

        // Goods the buyer handed back are physically here again, so they are not sold. The money
        // side already treats them that way — a مرتجع credits the buyer and debits the seller
        // (see GoodsReturnService) — while this view counted them as sold forever, so the two
        // disagreed about the same event and "المتوفر" read low by exactly what came back.
        var returnedLines = await _db.GoodsReturns
            .Where(r => r.Invoice.FarmerId == farmerId && r.Invoice.Status == InvoiceStatus.Active)
            .SelectMany(r => r.Items)
            .Select(ri => new { ri.ItemName, ri.Quantity, ri.WeightKg })
            .ToListAsync();

        var returnedByKey = returnedLines
            .GroupBy(l => l.ItemName.Trim().ToLowerInvariant())
            .ToDictionary(g => g.Key, g => (
                Total: g.Sum(l => l.Quantity),
                Weight: g.Sum(l => l.WeightKg ?? 0m)));

        var allKeys = receivedByKey.Keys.Union(soldByKey.Keys);
        var stock = allKeys.Select(key =>
        {
            var receivedAgg = receivedByKey.GetValueOrDefault(key);
            var soldAgg = soldByKey.GetValueOrDefault(key);
            var returnedAgg = returnedByKey.GetValueOrDefault(key);
            var sold = soldAgg.Total - returnedAgg.Total;
            var soldWeight = soldAgg.Weight - returnedAgg.Weight;
            var display = receivedByKey.TryGetValue(key, out var r) ? r.Display : soldByKey[key].Display;
            return new GoodsStockRow(
                display,
                receivedAgg.Total, sold, receivedAgg.Total - sold,
                receivedAgg.Weight, soldWeight, receivedAgg.Weight - soldWeight,
                receivedAgg.Wood, receivedAgg.Sack);
        })
        .OrderBy(r => r.ItemName)
        .ToList();

        var entryDtos = entries.Select(e => new GoodsEntryDto(
            e.Id, e.FarmerId, farmer.Name, e.Date, e.ItemName, e.Quantity, e.WeightKg, e.WoodQuantity, e.SackQuantity, e.Notes)).ToList();

        return new FarmerGoodsStockDto(farmer.Id, farmer.Name, entryDtos, stock);
    }

    /// <summary>
    /// Global counterpart of GetForFarmerAsync's Stock list, shown on "بضاعة الباعة"/"الإغلاق
    /// اليومي" — but unlike an earlier version of this method, it does NOT pool every farmer's
    /// numbers into one combined row per item: each row is scoped to one (farmer, item, unit), with
    /// FarmerId/FarmerName carried along, so the table can show whose stock every row actually is
    /// (two different farmers both bringing "بندورة" show as two separate rows, never summed
    /// together). Matches items within the SAME farmer by the same trimmed/case-insensitive
    /// ItemName+Unit key already used elsewhere. Sold is scoped to invoices that actually have a
    /// farmer attached (i.FarmerId != null) and joined back to that same farmer, consistent with the
    /// per-farmer version only ever counting that farmer's own invoices.
    ///
    /// Only rows with something left show up: a fully sold-out (farmer, item) is dropped entirely
    /// rather than listed at zero — see the Where at the end for why negative rows are kept. The
    /// per-farmer Stock list on "بضاعة الباعة" deliberately still shows its zero rows: that page is
    /// one farmer's full intake picture, where "brought 100, sold 100" is the answer, not noise.
    /// </summary>
    public async Task<IReadOnlyList<GoodsStockRow>> GetGlobalStockAsync()
    {
        var entries = await _db.FarmerGoodsEntries
            .Select(e => new { e.FarmerId, FarmerName = e.Farmer.Name, e.ItemName, e.Quantity, e.WeightKg, e.WoodQuantity, e.SackQuantity })
            .ToListAsync();

        var receivedByKey = entries
            .GroupBy(e => (e.FarmerId, Name: e.ItemName.Trim().ToLowerInvariant()))
            .ToDictionary(g => g.Key, g => (
                FarmerName: g.First().FarmerName,
                Display: g.First().ItemName.Trim(),
                Total: g.Sum(e => e.Quantity),
                Weight: g.Sum(e => e.WeightKg ?? 0m),
                Wood: g.Sum(e => e.WoodQuantity),
                Sack: g.Sum(e => e.SackQuantity)));

        var soldLines = await _db.Invoices
            .Where(i => i.FarmerId != null && i.Status == InvoiceStatus.Active)
            .SelectMany(i => i.Items.Select(it => new { FarmerId = i.FarmerId!.Value, FarmerName = i.Farmer!.Name, it.ItemName, it.Quantity, it.WeightKg }))
            .ToListAsync();

        var soldByKey = soldLines
            .GroupBy(l => (l.FarmerId, Name: l.ItemName.Trim().ToLowerInvariant()))
            .ToDictionary(g => g.Key, g => (
                FarmerName: g.First().FarmerName,
                Display: g.First().ItemName.Trim(),
                Total: g.Sum(l => l.Quantity),
                Weight: g.Sum(l => l.WeightKg ?? 0m)));

        // Same netting as the per-seller view above — see its comment.
        var returnedLines = await _db.GoodsReturns
            .Where(r => r.Invoice.FarmerId != null && r.Invoice.Status == InvoiceStatus.Active)
            .SelectMany(r => r.Items.Select(ri => new { FarmerId = r.Invoice.FarmerId!.Value, ri.ItemName, ri.Quantity, ri.WeightKg }))
            .ToListAsync();

        var returnedByKey = returnedLines
            .GroupBy(l => (l.FarmerId, Name: l.ItemName.Trim().ToLowerInvariant()))
            .ToDictionary(g => g.Key, g => (
                Total: g.Sum(l => l.Quantity),
                Weight: g.Sum(l => l.WeightKg ?? 0m)));

        var allKeys = receivedByKey.Keys.Union(soldByKey.Keys);
        return allKeys.Select(key =>
        {
            var receivedAgg = receivedByKey.GetValueOrDefault(key);
            var soldAgg = soldByKey.GetValueOrDefault(key);
            var returnedAgg = returnedByKey.GetValueOrDefault(key);
            var sold = soldAgg.Total - returnedAgg.Total;
            var soldWeight = soldAgg.Weight - returnedAgg.Weight;
            var display = receivedByKey.TryGetValue(key, out var r) ? r.Display : soldByKey[key].Display;
            var farmerName = receivedByKey.TryGetValue(key, out var r2) ? r2.FarmerName : soldByKey[key].FarmerName;
            return new GoodsStockRow(
                display,
                receivedAgg.Total, sold, receivedAgg.Total - sold,
                receivedAgg.Weight, soldWeight, receivedAgg.Weight - soldWeight,
                receivedAgg.Wood, receivedAgg.Sack, key.FarmerId, farmerName);
        })
        // "البضاعة المتوفرة حاليًا" means exactly that: an item a farmer brought in and has since
        // sold out of (Available == 0) is finished business and just pads the table — explicit
        // request to drop the whole row, not blank the number. Deliberately `!= 0` and NOT `> 0`:
        // a NEGATIVE row means more was sold than was ever logged as received, which is a missing
        // "إضافة بضاعة" entry someone needs to see and fix (see GetForFarmerAsync's own doc
        // comment for why those rows exist at all) — hiding those would bury the very problem
        // they're there to surface.
        .Where(r => r.Available != 0)
        .OrderBy(r => r.FarmerName).ThenBy(r => r.ItemName)
        .ToList();
    }

    public async Task<GoodsEntryDto> CreateAsync(CreateGoodsEntryRequest request, int recordedByUserId)
    {
        // "بضاعة الباعة" is seller-side by definition (see the interface doc comment) — the id
        // wasn't checked beyond existing before, so a merchant or driver id could be recorded as a
        // "farmer" stock entry and silently corrupt that person's goods-stock numbers.
        var farmer = await _db.Partners.FindAsync(request.FarmerId) ?? throw new NotFoundAppException("Partner (farmer)", request.FarmerId);
        // Type itself is nullable (staff can record a person before knowing their role) — a
        // still-unset Type is passed through rather than rejected, same as every other type check
        // added across this pass (see PaymentService.PartnerTypeMatches's doc comment).
        if (!PartnerRoles.CanBe(farmer.Type, PartnerType.Farmer))
            throw new ValidationAppException($"الشخص المحدد ({farmer.Name}) ليس بائعًا — لا يمكن تسجيل بضاعة له.");
        ValidateLine(request.ItemName, request.Quantity, request.WoodQuantity, request.SackQuantity);

        // Same "type it once, pick it from a list every time after" growth as InvoiceService.
        await _items.FindOrCreateAsync(request.ItemName);

        var entry = new FarmerGoodsEntry
        {
            FarmerId = farmer.Id,
            Date = request.Date,
            ItemName = request.ItemName.Trim(),
            Quantity = request.Quantity,
            WeightKg = request.WeightKg,
            WoodQuantity = request.WoodQuantity,
            SackQuantity = request.SackQuantity,
            Notes = request.Notes,
            CreatedByUserId = recordedByUserId
        };
        _db.FarmerGoodsEntries.Add(entry);
        await _db.SaveChangesAsync();

        return new GoodsEntryDto(entry.Id, entry.FarmerId, farmer.Name, entry.Date, entry.ItemName, entry.Quantity, entry.WeightKg, entry.WoodQuantity, entry.SackQuantity, entry.Notes);
    }

    public async Task<GoodsEntryDto> UpdateAsync(int id, UpdateGoodsEntryRequest request)
    {
        var entry = await _db.FarmerGoodsEntries.FindAsync(id) ?? throw new NotFoundAppException("FarmerGoodsEntry", id);
        ValidateLine(request.ItemName, request.Quantity, request.WoodQuantity, request.SackQuantity);

        await _items.FindOrCreateAsync(request.ItemName);

        entry.Date = request.Date;
        entry.ItemName = request.ItemName.Trim();
        entry.Quantity = request.Quantity;
        entry.WeightKg = request.WeightKg;
        entry.WoodQuantity = request.WoodQuantity;
        entry.SackQuantity = request.SackQuantity;
        entry.Notes = request.Notes;
        await _db.SaveChangesAsync();

        var farmer = await _db.Partners.FindAsync(entry.FarmerId);
        return new GoodsEntryDto(entry.Id, entry.FarmerId, farmer?.Name ?? "", entry.Date, entry.ItemName, entry.Quantity, entry.WeightKg, entry.WoodQuantity, entry.SackQuantity, entry.Notes);
    }

    /// <summary>Soft-delete, same convention as every other AuditableEntity — a mistaken intake
    /// entry disappears from the log and from the stock computation above, without losing the
    /// audit trail of it ever having existed.</summary>
    public async Task DeleteAsync(int id)
    {
        var entry = await _db.FarmerGoodsEntries.FindAsync(id) ?? throw new NotFoundAppException("FarmerGoodsEntry", id);
        entry.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    // WoodQuantity is a physical crate COUNT, independent of Quantity/Unit — e.g. 50 كغم of
    // tomatoes carried in 3 wooden crates is a perfectly valid entry, and "3 > 50" was never a
    // meaningful comparison to begin with (comparing a crate count to a weight). There is
    // deliberately no upper bound tying it to Quantity — see GoodsEntryDto's doc comment.
    private static void ValidateLine(string itemName, decimal quantity, decimal woodQuantity, decimal sackQuantity)
    {
        if (string.IsNullOrWhiteSpace(itemName))
            throw new ValidationAppException("An item name is required.");
        if (quantity <= 0)
            throw new ValidationAppException("Quantity must be greater than zero.");
        if (sackQuantity < 0)
            throw new ValidationAppException("عدد المخالات لا يمكن أن يكون سالبًا.");
        if (woodQuantity < 0)
            throw new ValidationAppException("Wood quantity cannot be negative.");
    }
}
