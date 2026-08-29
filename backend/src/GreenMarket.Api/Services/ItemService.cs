using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IItemService
{
    /// <summary>
    /// Same "select from a growing list" pattern as PartnerService.SuggestAsync: an empty/blank
    /// query returns a full pick-list (most recently used first) so the field behaves like a
    /// real dropdown the moment it's focused, not just a typeahead. A non-blank query narrows it.
    /// </summary>
    Task<IReadOnlyList<ItemDto>> SuggestAsync(string? query);

    /// <summary>Case-insensitive find-or-create, mirroring PartnerService — a brand new item name
    /// typed on an invoice line is added to the catalog automatically so it's there to pick next time.</summary>
    Task<Item> FindOrCreateAsync(string name);

    /// <summary>The Items management page (mirrors PartnersPage): a searchable, paged list of the
    /// whole catalog so items can be added/renamed/removed directly, not only picked up
    /// incidentally from invoices.</summary>
    Task<PagedResult<ItemDto>> ListAsync(string? search, int page, int pageSize);
    Task<ItemDto> CreateAsync(CreateItemRequest request);
    Task<ItemDto> UpdateAsync(int id, UpdateItemRequest request);
    Task DeleteAsync(int id);
}

public class ItemService : IItemService
{
    private readonly AppDbContext _db;
    public ItemService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ItemDto>> SuggestAsync(string? query)
    {
        var trimmed = query?.Trim() ?? string.Empty;
        var q = _db.Items.AsQueryable();
        if (!string.IsNullOrEmpty(trimmed))
            q = q.Where(i => i.Name.Contains(trimmed));

        return await q
            .OrderByDescending(i => i.CreatedAt)
            .Take(string.IsNullOrEmpty(trimmed) ? 100 : 20)
            .OrderBy(i => i.Name)
            .Select(i => new ItemDto(i.Id, i.Name))
            .ToListAsync();
    }

    public async Task<Item> FindOrCreateAsync(string name)
    {
        var trimmed = name.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            throw new ValidationAppException("An item name is required.");

        var normalized = trimmed.ToLower();
        var existing = await _db.Items.SingleOrDefaultAsync(i => i.Name.ToLower() == normalized);
        if (existing is not null) return existing;

        var item = new Item { Name = trimmed };
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        return item;
    }

    public async Task<PagedResult<ItemDto>> ListAsync(string? search, int page, int pageSize)
    {
        var query = _db.Items.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(i => i.Name.Contains(search));

        var total = await query.CountAsync();
        var items = await query.OrderBy(i => i.Name)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(i => new ItemDto(i.Id, i.Name))
            .ToListAsync();

        return new PagedResult<ItemDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task<ItemDto> CreateAsync(CreateItemRequest request)
    {
        var trimmed = request.Name.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            throw new ValidationAppException("An item name is required.");

        var normalized = trimmed.ToLower();
        if (await _db.Items.AnyAsync(i => i.Name.ToLower() == normalized))
            throw new ConflictAppException("An item with this name already exists.");

        var item = new Item { Name = trimmed };
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        return new ItemDto(item.Id, item.Name);
    }

    public async Task<ItemDto> UpdateAsync(int id, UpdateItemRequest request)
    {
        var item = await _db.Items.FindAsync(id) ?? throw new NotFoundAppException("Item", id);
        var trimmed = request.Name.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            throw new ValidationAppException("An item name is required.");

        var normalized = trimmed.ToLower();
        if (await _db.Items.AnyAsync(i => i.Id != id && i.Name.ToLower() == normalized))
            throw new ConflictAppException("An item with this name already exists.");

        item.Name = trimmed;
        await _db.SaveChangesAsync();
        return new ItemDto(item.Id, item.Name);
    }

    public async Task DeleteAsync(int id)
    {
        var item = await _db.Items.FindAsync(id) ?? throw new NotFoundAppException("Item", id);
        // Safe to remove outright: invoice lines store the item name as plain text (denormalized),
        // not a foreign key to this table, so deleting a catalog entry never touches past invoices —
        // it only stops that name from being suggested going forward.
        _db.Items.Remove(item);
        await _db.SaveChangesAsync();
    }
}
