using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
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

        // Wood is summed here too (independent of Total — a plain crate count, never bounded by or
        // compared against Quantity/Unit — see GoodsStockRow's doc comment).
        var receivedByKey = entries
            .GroupBy(e => (Name: e.ItemName.Trim().ToLowerInvariant(), e.Unit))
            .ToDictionary(g => g.Key, g => (Display: g.First().ItemName.Trim(), Total: g.Sum(e => e.Quantity), Wood: g.Sum(e => e.WoodQuantity)));

        // Same "materialize then group in memory" choice as GetFarmerGoodsAsync — only ever this
        // one farmer's Active invoices, so it's cheap and side-steps translating a correlated
        // string-normalization GroupBy key through the Npgsql EF provider.
        var soldLines = await _db.Invoices
            .Where(i => i.FarmerId == farmerId && i.Status == InvoiceStatus.Active)
            .SelectMany(i => i.Items)
            .Select(it => new { it.ItemName, it.Unit, it.Quantity })
            .ToListAsync();

        var soldByKey = soldLines
            .GroupBy(l => (Name: l.ItemName.Trim().ToLowerInvariant(), l.Unit))
            .ToDictionary(g => g.Key, g => (Display: g.First().ItemName.Trim(), Total: g.Sum(l => l.Quantity)));

        var allKeys = receivedByKey.Keys.Union(soldByKey.Keys);
        var stock = allKeys.Select(key =>
        {
            var receivedAgg = receivedByKey.GetValueOrDefault(key);
            var received = receivedAgg.Total;
            var wood = receivedAgg.Wood;
            var sold = soldByKey.GetValueOrDefault(key).Total;
            var display = receivedByKey.TryGetValue(key, out var r) ? r.Display : soldByKey[key].Display;
            return new GoodsStockRow(display, key.Unit, received, sold, received - sold, wood);
        })
        .OrderBy(r => r.ItemName)
        .ToList();

        var entryDtos = entries.Select(e => new GoodsEntryDto(
            e.Id, e.FarmerId, farmer.Name, e.Date, e.ItemName, e.Unit, e.Quantity, e.WoodQuantity, e.Notes)).ToList();

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
    /// </summary>
    public async Task<IReadOnlyList<GoodsStockRow>> GetGlobalStockAsync()
    {
        var entries = await _db.FarmerGoodsEntries
            .Select(e => new { e.FarmerId, FarmerName = e.Farmer.Name, e.ItemName, e.Unit, e.Quantity, e.WoodQuantity })
            .ToListAsync();

        var receivedByKey = entries
            .GroupBy(e => (e.FarmerId, Name: e.ItemName.Trim().ToLowerInvariant(), e.Unit))
            .ToDictionary(g => g.Key, g => (
                FarmerName: g.First().FarmerName,
                Display: g.First().ItemName.Trim(),
                Total: g.Sum(e => e.Quantity),
                Wood: g.Sum(e => e.WoodQuantity)));

        var soldLines = await _db.Invoices
            .Where(i => i.FarmerId != null && i.Status == InvoiceStatus.Active)
            .SelectMany(i => i.Items.Select(it => new { FarmerId = i.FarmerId!.Value, FarmerName = i.Farmer!.Name, it.ItemName, it.Unit, it.Quantity }))
            .ToListAsync();

        var soldByKey = soldLines
            .GroupBy(l => (l.FarmerId, Name: l.ItemName.Trim().ToLowerInvariant(), l.Unit))
            .ToDictionary(g => g.Key, g => (FarmerName: g.First().FarmerName, Display: g.First().ItemName.Trim(), Total: g.Sum(l => l.Quantity)));

        var allKeys = receivedByKey.Keys.Union(soldByKey.Keys);
        return allKeys.Select(key =>
        {
            var receivedAgg = receivedByKey.GetValueOrDefault(key);
            var received = receivedAgg.Total;
            var wood = receivedAgg.Wood;
            var sold = soldByKey.GetValueOrDefault(key).Total;
            var display = receivedByKey.TryGetValue(key, out var r) ? r.Display : soldByKey[key].Display;
            var farmerName = receivedByKey.TryGetValue(key, out var r2) ? r2.FarmerName : soldByKey[key].FarmerName;
            return new GoodsStockRow(display, key.Unit, received, sold, received - sold, wood, key.FarmerId, farmerName);
        })
        .OrderBy(r => r.FarmerName).ThenBy(r => r.ItemName)
        .ToList();
    }

    public async Task<GoodsEntryDto> CreateAsync(CreateGoodsEntryRequest request, int recordedByUserId)
    {
        var farmer = await _db.Partners.FindAsync(request.FarmerId) ?? throw new NotFoundAppException("Partner (farmer)", request.FarmerId);
        ValidateLine(request.ItemName, request.Quantity, request.WoodQuantity);

        // Same "type it once, pick it from a list every time after" growth as InvoiceService.
        await _items.FindOrCreateAsync(request.ItemName);

        var entry = new FarmerGoodsEntry
        {
            FarmerId = farmer.Id,
            Date = request.Date,
            ItemName = request.ItemName.Trim(),
            Unit = request.Unit,
            Quantity = request.Quantity,
            WoodQuantity = request.WoodQuantity,
            Notes = request.Notes,
            CreatedByUserId = recordedByUserId
        };
        _db.FarmerGoodsEntries.Add(entry);
        await _db.SaveChangesAsync();

        return new GoodsEntryDto(entry.Id, entry.FarmerId, farmer.Name, entry.Date, entry.ItemName, entry.Unit, entry.Quantity, entry.WoodQuantity, entry.Notes);
    }

    public async Task<GoodsEntryDto> UpdateAsync(int id, UpdateGoodsEntryRequest request)
    {
        var entry = await _db.FarmerGoodsEntries.FindAsync(id) ?? throw new NotFoundAppException("FarmerGoodsEntry", id);
        ValidateLine(request.ItemName, request.Quantity, request.WoodQuantity);

        await _items.FindOrCreateAsync(request.ItemName);

        entry.Date = request.Date;
        entry.ItemName = request.ItemName.Trim();
        entry.Unit = request.Unit;
        entry.Quantity = request.Quantity;
        entry.WoodQuantity = request.WoodQuantity;
        entry.Notes = request.Notes;
        await _db.SaveChangesAsync();

        var farmer = await _db.Partners.FindAsync(entry.FarmerId);
        return new GoodsEntryDto(entry.Id, entry.FarmerId, farmer?.Name ?? "", entry.Date, entry.ItemName, entry.Unit, entry.Quantity, entry.WoodQuantity, entry.Notes);
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
    private static void ValidateLine(string itemName, decimal quantity, decimal woodQuantity)
    {
        if (string.IsNullOrWhiteSpace(itemName))
            throw new ValidationAppException("An item name is required.");
        if (quantity <= 0)
            throw new ValidationAppException("Quantity must be greater than zero.");
        if (woodQuantity < 0)
            throw new ValidationAppException("Wood quantity cannot be negative.");
    }
}
