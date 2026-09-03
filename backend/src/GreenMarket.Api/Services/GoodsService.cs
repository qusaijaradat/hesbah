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

        var receivedByKey = entries
            .GroupBy(e => (Name: e.ItemName.Trim().ToLowerInvariant(), e.Unit))
            .ToDictionary(g => g.Key, g => (Display: g.First().ItemName.Trim(), Total: g.Sum(e => e.Quantity)));

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
            var received = receivedByKey.GetValueOrDefault(key).Total;
            var sold = soldByKey.GetValueOrDefault(key).Total;
            var display = receivedByKey.TryGetValue(key, out var r) ? r.Display : soldByKey[key].Display;
            return new GoodsStockRow(display, key.Unit, received, sold, received - sold);
        })
        .OrderBy(r => r.ItemName)
        .ToList();

        var entryDtos = entries.Select(e => new GoodsEntryDto(
            e.Id, e.FarmerId, farmer.Name, e.Date, e.ItemName, e.Unit, e.Quantity, e.WoodQuantity, e.Notes)).ToList();

        return new FarmerGoodsStockDto(farmer.Id, farmer.Name, entryDtos, stock);
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

    private static void ValidateLine(string itemName, decimal quantity, decimal woodQuantity)
    {
        if (string.IsNullOrWhiteSpace(itemName))
            throw new ValidationAppException("An item name is required.");
        if (quantity <= 0)
            throw new ValidationAppException("Quantity must be greater than zero.");
        if (woodQuantity < 0)
            throw new ValidationAppException("Wood quantity cannot be negative.");
        if (woodQuantity > quantity)
            throw new ValidationAppException("Wood quantity cannot exceed the total quantity.");
    }
}
