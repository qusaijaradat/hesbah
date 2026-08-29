using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IPartnerService
{
    Task<PagedResult<PartnerDto>> ListAsync(string? search, PartnerType? type, int page, int pageSize);
    Task<IReadOnlyList<PartnerSuggestionDto>> SuggestAsync(string? query);
    Task<PartnerDto> GetAsync(int id);
    Task<PartnerDto> CreateAsync(CreatePartnerRequest request);
    Task<PartnerDto> UpdateAsync(int id, UpdatePartnerRequest request);

    /// <summary>
    /// Requirement doc §3: names are typed fresh most days (a different trader/farmer, not fixed
    /// people), with suggestions shown for names used before. This is the "or create" half of that:
    /// looks up an existing partner by exact name (case-insensitive, trimmed); if found, and this
    /// side's type isn't already covered, upgrades them to Both (the same person can be a farmer on
    /// one invoice and a merchant on another). If no match exists, creates a brand new partner.
    /// </summary>
    Task<Partner> FindOrCreateAsync(string name, PartnerType type);
    Task<MerchantAccountDto> GetMerchantAccountAsync(int id);
    Task<FarmerAccountDto> GetFarmerAccountAsync(int id);
}

public class PartnerService : IPartnerService
{
    private readonly AppDbContext _db;

    public PartnerService(AppDbContext db) => _db = db;

    public async Task<PagedResult<PartnerDto>> ListAsync(string? search, PartnerType? type, int page, int pageSize)
    {
        var query = _db.Partners.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(p => p.Name.Contains(search));
        if (type is not null)
            query = query.Where(p => p.Type == type);

        var total = await query.CountAsync();
        var items = await query.OrderBy(p => p.Name)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => ToDto(p))
            .ToListAsync();

        return new PagedResult<PartnerDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    /// <summary>
    /// Requirement doc §3: "while typing a name, suggestions of existing names appear." An empty/blank
    /// query returns a full pick-list instead of nothing, so the field behaves like a real dropdown
    /// the moment it's focused (click it and see everyone), not just a typeahead you must start typing
    /// into first.
    /// </summary>
    public async Task<IReadOnlyList<PartnerSuggestionDto>> SuggestAsync(string? query)
    {
        var trimmed = query?.Trim() ?? string.Empty;
        var q = _db.Partners.AsQueryable();
        if (!string.IsNullOrEmpty(trimmed))
            q = q.Where(p => p.Name.Contains(trimmed));

        return await q
            .OrderBy(p => p.Name)
            .Take(string.IsNullOrEmpty(trimmed) ? 100 : 10)
            .Select(p => new PartnerSuggestionDto(p.Id, p.Name, p.Type))
            .ToListAsync();
    }

    public async Task<PartnerDto> GetAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);
        return ToDto(partner);
    }

    public async Task<PartnerDto> CreateAsync(CreatePartnerRequest request)
    {
        var partner = new Partner
        {
            Name = request.Name.Trim(),
            Type = request.Type,
            WhatsAppNumber = request.WhatsAppNumber,
            Notes = request.Notes,
            CreditLimit = request.CreditLimit
        };
        _db.Partners.Add(partner);
        await _db.SaveChangesAsync();
        return ToDto(partner);
    }

    public async Task<Partner> FindOrCreateAsync(string name, PartnerType type)
    {
        var trimmed = name.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            throw new ValidationAppException("A name is required.");

        // Case-insensitive exact match. EF/Npgsql translates ToLower() to the SQL `lower()`
        // function, so this runs as a proper server-side query rather than pulling the whole
        // Partners table into memory.
        var normalized = trimmed.ToLower();
        var existing = await _db.Partners.SingleOrDefaultAsync(p => p.Name.ToLower() == normalized);

        if (existing is not null)
        {
            if (existing.Type is not null && existing.Type != type && existing.Type != PartnerType.Both)
            {
                existing.Type = PartnerType.Both;
                await _db.SaveChangesAsync();
            }
            else if (existing.Type is null)
            {
                existing.Type = type;
                await _db.SaveChangesAsync();
            }
            return existing;
        }

        var partner = new Partner { Name = trimmed, Type = type };
        _db.Partners.Add(partner);
        await _db.SaveChangesAsync();
        return partner;
    }

    public async Task<PartnerDto> UpdateAsync(int id, UpdatePartnerRequest request)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);
        partner.Name = request.Name.Trim();
        partner.Type = request.Type;
        partner.WhatsAppNumber = request.WhatsAppNumber;
        partner.Notes = request.Notes;
        partner.CreditLimit = request.CreditLimit;
        await _db.SaveChangesAsync();
        return ToDto(partner);
    }

    /// <summary>Requirement doc §6: merchant account = invoices, total purchases, paid, remaining + statement.</summary>
    public async Task<MerchantAccountDto> GetMerchantAccountAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        var invoices = await _db.Invoices
            .Where(i => i.MerchantId == id && i.Status == InvoiceStatus.Active)
            .Select(i => new { i.Date, i.InvoiceNumber, i.TotalValue })
            .ToListAsync();

        var payments = await _db.Payments
            .Where(p => p.PartnerId == id && p.Direction == PaymentDirection.FromMerchant)
            .Select(p => new { p.Date, p.Amount })
            .ToListAsync();

        var entries = invoices.Select(i => new AccountStatementBuilder.Entry(i.Date, $"Invoice {i.InvoiceNumber}", i.TotalValue))
            .Concat(payments.Select(p => new AccountStatementBuilder.Entry(p.Date, "Payment received", -p.Amount)));

        var statement = AccountStatementBuilder.Build(entries);
        var totalPurchases = invoices.Sum(i => i.TotalValue);
        var totalPaid = payments.Sum(p => p.Amount);
        var remaining = totalPurchases - totalPaid;
        var isOverLimit = partner.CreditLimit is not null && remaining > partner.CreditLimit;

        return new MerchantAccountDto(
            partner.Id, partner.Name,
            totalPurchases, totalPaid, remaining,
            partner.CreditLimit, isOverLimit,
            statement.Select(ToStatementLineDto).ToList());
    }

    /// <summary>Requirement doc §6: farmer account = value sold, commission, due, paid, remaining + statement.</summary>
    public async Task<FarmerAccountDto> GetFarmerAccountAsync(int id)
    {
        var partner = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException("Partner", id);

        var transactions = await _db.FarmerTransactions
            .Where(t => t.FarmerId == id)
            .OrderBy(t => t.Date)
            .ToListAsync();

        var entries = transactions.Select(t => new AccountStatementBuilder.Entry(
            t.Date,
            t.Type == FarmerTransactionType.Sale ? $"Sale (invoice #{t.InvoiceId})" : "Payment to farmer",
            t.Amount));

        var statement = AccountStatementBuilder.Build(entries);

        var totalSales = transactions.Where(t => t.Type == FarmerTransactionType.Sale).Sum(t => t.SaleValue);
        var totalCommission = transactions.Where(t => t.Type == FarmerTransactionType.Sale).Sum(t => t.Commission);
        var totalNetDue = transactions.Where(t => t.Type == FarmerTransactionType.Sale).Sum(t => t.Amount);
        var totalPaid = transactions.Where(t => t.Type == FarmerTransactionType.Payment).Sum(t => -t.Amount);

        return new FarmerAccountDto(
            partner.Id, partner.Name,
            totalSales, totalCommission, totalNetDue, totalPaid, totalNetDue - totalPaid,
            statement.Select(ToStatementLineDto).ToList());
    }

    private static StatementLineDto ToStatementLineDto(AccountStatementBuilder.StatementLine line) =>
        new(line.Date, line.Description, line.SignedAmount, line.RunningBalance);

    private static PartnerDto ToDto(Partner p) => new(p.Id, p.Name, p.Type, p.WhatsAppNumber, p.Notes, p.CreditLimit);
}
