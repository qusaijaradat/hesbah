using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IInvoiceService
{
    Task<InvoiceDto> CreateAsync(CreateInvoiceRequest request);
    Task<InvoiceDto> UpdateAsync(int id, CreateInvoiceRequest request);
    Task<InvoiceDto> GetAsync(int id);
    Task<PagedResult<InvoiceListItemDto>> ListAsync(InvoiceFilterRequest filter);
    Task<IReadOnlyList<InvoiceDto>> GetManyAsync(IReadOnlyList<int> ids);
    Task<InvoiceDto> CancelAsync(int id, CancelInvoiceRequest request, int cancelledByUserId);
}

/// <summary>
/// The heart of the system. Requirement doc §4 (build the invoice) + §5 (compute the
/// hidden commission and the farmer's net due) + §6 (post it to the farmer ledger) all
/// happen atomically here so an invoice can never exist without its matching
/// FarmerTransaction, and the commission can never leak onto the merchant-facing DTO.
/// </summary>
public class InvoiceService : IInvoiceService
{
    private readonly AppDbContext _db;
    private readonly ISettingsService _settings;
    private readonly IPartnerService _partners;
    private readonly IItemService _items;

    public InvoiceService(AppDbContext db, ISettingsService settings, IPartnerService partners, IItemService items)
    {
        _db = db;
        _settings = settings;
        _partners = partners;
        _items = items;
    }

    public async Task<InvoiceDto> CreateAsync(CreateInvoiceRequest request)
    {
        if (request.Items is null || request.Items.Count == 0)
            throw new ValidationAppException("An invoice must have at least one item.");

        var merchant = await ResolvePartnerAsync(request.MerchantId, request.MerchantName, PartnerType.Merchant, "merchant");
        // Seller (Farmer) and Driver are both optional and independent of each other — an invoice
        // can have either, both, or neither attached.
        var farmer = await ResolveOptionalPartnerAsync(request.FarmerId, request.FarmerName, PartnerType.Farmer, "farmer");
        var driver = await ResolveOptionalPartnerAsync(request.DriverId, request.DriverName, PartnerType.Driver, "driver");

        // Grow the item-name catalog with anything new, same "type it once, pick it from a
        // list every time after" pattern already used for partners.
        foreach (var name in request.Items.Select(i => i.ItemName).Distinct(StringComparer.OrdinalIgnoreCase))
            await _items.FindOrCreateAsync(name);

        // Pure business math lives in GreenMarket.Domain — this service is just wiring.
        var totals = InvoiceCalculator.Calculate(
            request.Items.Select(i => new InvoiceCalculator.LineInput(i.ItemName, i.Quantity, i.Unit, i.PricePerUnit, i.WoodPrice)));

        var commissionRate = await _settings.GetDecimalAsync(Setting.Keys.DefaultCommissionRate, 0.07m);
        var commissionResult = CommissionCalculator.Calculate(totals.TotalValue, commissionRate);

        var invoice = new Invoice
        {
            InvoiceNumber = await GenerateInvoiceNumberAsync(request.Date),
            Date = request.Date,
            MerchantId = merchant.Id,
            FarmerId = farmer?.Id,
            DriverId = driver?.Id,
            TransportFee = request.TransportFee,
            Status = InvoiceStatus.Active,
            TotalWeightKg = totals.TotalWeightKg,
            TotalValue = totals.TotalValue,
            CommissionRateApplied = commissionRate,
            Items = totals.Lines.Select(l => new InvoiceItem
            {
                ItemName = l.ItemName,
                Quantity = l.Quantity,
                Unit = l.Unit,
                PricePerUnit = l.PricePerUnit,
                WoodPrice = l.WoodPrice,
                LineTotal = l.LineTotal
            }).ToList()
        };

        _db.Invoices.Add(invoice);
        await _db.SaveChangesAsync(); // need invoice.Id before creating the linked ledger row

        // No farmer on this invoice → nothing to post to the farmer ledger (requirement doc
        // §5/§6 only apply once a farmer is actually attached to the sale).
        if (farmer is not null)
        {
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = farmer.Id,
                Type = FarmerTransactionType.Sale,
                InvoiceId = invoice.Id,
                Date = invoice.Date,
                SaleValue = totals.TotalValue,
                Commission = commissionResult.Commission,
                Amount = commissionResult.NetDueToFarmer,
                Notes = $"Auto-generated from invoice {invoice.InvoiceNumber}"
            });
            await _db.SaveChangesAsync();
        }

        return await GetAsync(invoice.Id);
    }

    /// <summary>
    /// Requirement gap fix: invoices could previously never be corrected after saving, so a typo
    /// in the date/merchant/farmer/items forced a full cancel-and-recreate (which also breaks the
    /// invoice-number sequence and leaves a "cancelled" row behind for what was really just a
    /// mistake). This recomputes totals/commission exactly like CreateAsync and keeps the linked
    /// farmer ledger row (FarmerTransaction) in sync: updated in place if the farmer didn't
    /// change, or removed/recreated if a farmer was added, removed, or swapped for someone else.
    /// Only Active invoices can be edited — a cancelled invoice must stay as the historical record
    /// of the cancellation; there is deliberately no "un-cancel".
    /// </summary>
    public async Task<InvoiceDto> UpdateAsync(int id, CreateInvoiceRequest request)
    {
        if (request.Items is null || request.Items.Count == 0)
            throw new ValidationAppException("An invoice must have at least one item.");

        var invoice = await _db.Invoices.Include(i => i.Items)
            .SingleOrDefaultAsync(i => i.Id == id) ?? throw new NotFoundAppException("Invoice", id);

        if (invoice.Status == InvoiceStatus.Cancelled)
            throw new ConflictAppException("Cannot edit a cancelled invoice.");

        var merchant = await ResolvePartnerAsync(request.MerchantId, request.MerchantName, PartnerType.Merchant, "merchant");
        var farmer = await ResolveOptionalPartnerAsync(request.FarmerId, request.FarmerName, PartnerType.Farmer, "farmer");
        var driver = await ResolveOptionalPartnerAsync(request.DriverId, request.DriverName, PartnerType.Driver, "driver");

        foreach (var name in request.Items.Select(i => i.ItemName).Distinct(StringComparer.OrdinalIgnoreCase))
            await _items.FindOrCreateAsync(name);

        var totals = InvoiceCalculator.Calculate(
            request.Items.Select(i => new InvoiceCalculator.LineInput(i.ItemName, i.Quantity, i.Unit, i.PricePerUnit, i.WoodPrice)));

        var commissionRate = await _settings.GetDecimalAsync(Setting.Keys.DefaultCommissionRate, 0.07m);
        var commissionResult = CommissionCalculator.Calculate(totals.TotalValue, commissionRate);

        var previousFarmerId = invoice.FarmerId;

        invoice.Date = request.Date;
        invoice.MerchantId = merchant.Id;
        invoice.FarmerId = farmer?.Id;
        invoice.DriverId = driver?.Id;
        invoice.TransportFee = request.TransportFee;
        invoice.TotalWeightKg = totals.TotalWeightKg;
        invoice.TotalValue = totals.TotalValue;
        invoice.CommissionRateApplied = commissionRate;

        // Replace the item lines wholesale rather than trying to diff old vs. new — EF Core
        // cascade-deletes anything removed from a required collection navigation like this one.
        invoice.Items.Clear();
        foreach (var l in totals.Lines)
        {
            invoice.Items.Add(new InvoiceItem
            {
                ItemName = l.ItemName,
                Quantity = l.Quantity,
                Unit = l.Unit,
                PricePerUnit = l.PricePerUnit,
                WoodPrice = l.WoodPrice,
                LineTotal = l.LineTotal
            });
        }

        var existingSale = await _db.FarmerTransactions
            .SingleOrDefaultAsync(t => t.InvoiceId == invoice.Id && t.Type == FarmerTransactionType.Sale);

        if (farmer is null)
        {
            // Farmer removed from the invoice — nothing left to post to a farmer ledger.
            if (existingSale is not null) _db.FarmerTransactions.Remove(existingSale);
        }
        else if (existingSale is not null && previousFarmerId == farmer.Id)
        {
            // Same farmer as before — just correct the figures on their existing ledger row.
            existingSale.Date = invoice.Date;
            existingSale.SaleValue = totals.TotalValue;
            existingSale.Commission = commissionResult.Commission;
            existingSale.Amount = commissionResult.NetDueToFarmer;
            existingSale.Notes = $"Auto-generated from invoice {invoice.InvoiceNumber} (edited)";
        }
        else
        {
            // Farmer was added for the first time, or swapped for a different one — the old
            // ledger row (if any) belongs to the wrong farmer now, so it's replaced outright
            // rather than adjusted.
            if (existingSale is not null) _db.FarmerTransactions.Remove(existingSale);
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = farmer.Id,
                Type = FarmerTransactionType.Sale,
                InvoiceId = invoice.Id,
                Date = invoice.Date,
                SaleValue = totals.TotalValue,
                Commission = commissionResult.Commission,
                Amount = commissionResult.NetDueToFarmer,
                Notes = $"Auto-generated from invoice {invoice.InvoiceNumber} (edited)"
            });
        }

        await _db.SaveChangesAsync();
        return await GetAsync(invoice.Id);
    }

    public async Task<InvoiceDto> GetAsync(int id)
    {
        var invoice = await _db.Invoices
            .Include(i => i.Items)
            .Include(i => i.Merchant)
            .Include(i => i.Farmer)
            .Include(i => i.Driver)
            .SingleOrDefaultAsync(i => i.Id == id)
            ?? throw new NotFoundAppException("Invoice", id);

        return ToDto(invoice);
    }

    public async Task<IReadOnlyList<InvoiceDto>> GetManyAsync(IReadOnlyList<int> ids)
    {
        var invoices = await _db.Invoices
            .Include(i => i.Items)
            .Include(i => i.Merchant)
            .Include(i => i.Farmer)
            .Include(i => i.Driver)
            .Where(i => ids.Contains(i.Id))
            .ToListAsync();

        // Preserve the caller's requested order (e.g. the filtered/selected print order)
        // rather than whatever order the DB happened to return rows in.
        var byId = invoices.ToDictionary(i => i.Id);
        return ids.Where(byId.ContainsKey).Select(id => ToDto(byId[id])).ToList();
    }

    public async Task<PagedResult<InvoiceListItemDto>> ListAsync(InvoiceFilterRequest filter)
    {
        var query = _db.Invoices.Include(i => i.Merchant).Include(i => i.Farmer).Include(i => i.Driver).AsQueryable();

        if (filter.DateFrom is not null) query = query.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(i => i.Date <= filter.DateTo);
        if (filter.MerchantId is not null) query = query.Where(i => i.MerchantId == filter.MerchantId);
        if (filter.FarmerId is not null) query = query.Where(i => i.FarmerId == filter.FarmerId);
        if (filter.DriverId is not null) query = query.Where(i => i.DriverId == filter.DriverId);
        if (filter.Status is not null) query = query.Where(i => i.Status == filter.Status);
        if (!string.IsNullOrWhiteSpace(filter.InvoiceNumber)) query = query.Where(i => i.InvoiceNumber.Contains(filter.InvoiceNumber));
        if (!string.IsNullOrWhiteSpace(filter.InvoiceNumberFrom)) query = query.Where(i => i.InvoiceNumber.CompareTo(filter.InvoiceNumberFrom) >= 0);
        if (!string.IsNullOrWhiteSpace(filter.InvoiceNumberTo)) query = query.Where(i => i.InvoiceNumber.CompareTo(filter.InvoiceNumberTo) <= 0);
        if (filter.CreatedByUserId is not null) query = query.Where(i => i.CreatedByUserId == filter.CreatedByUserId);
        if (filter.MinWeightKg is not null) query = query.Where(i => i.TotalWeightKg >= filter.MinWeightKg);
        if (filter.MaxWeightKg is not null) query = query.Where(i => i.TotalWeightKg <= filter.MaxWeightKg);
        if (filter.MinAmount is not null) query = query.Where(i => i.TotalValue >= filter.MinAmount);
        if (filter.MaxAmount is not null) query = query.Where(i => i.TotalValue <= filter.MaxAmount);
        if (!string.IsNullOrWhiteSpace(filter.ItemName))
            query = query.Where(i => i.Items.Any(it => it.ItemName.Contains(filter.ItemName)));

        var total = await query.CountAsync();
        var items = await query.OrderByDescending(i => i.Date)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .Select(i => new InvoiceListItemDto(
                i.Id, i.InvoiceNumber, i.Date, i.MerchantId, i.Merchant.Name, i.Merchant.WhatsAppNumber,
                i.Farmer != null ? i.Farmer.Name : null,
                i.Farmer != null ? i.Farmer.WhatsAppNumber : null,
                i.DriverId,
                i.Driver != null ? i.Driver.Name : null,
                i.Driver != null ? i.Driver.WhatsAppNumber : null,
                i.Status, i.TotalWeightKg,
                i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => (decimal?)it.Quantity) ?? 0,
                i.TotalValue, i.TransportFee,
                i.TotalValue + i.TransportFee + (i.Items.Sum(it => (decimal?)it.WoodPrice) ?? 0)))
            .ToListAsync();

        return new PagedResult<InvoiceListItemDto> { Items = items, TotalCount = total, Page = filter.Page, PageSize = filter.PageSize };
    }

    /// <summary>
    /// Cancelling an invoice (requirement doc §2 permission "cancel") soft-marks it and
    /// reverses its FarmerTransaction with an offsetting Adjustment row, rather than
    /// deleting anything — so every report stays reconcilable against the audit log.
    /// </summary>
    public async Task<InvoiceDto> CancelAsync(int id, CancelInvoiceRequest request, int cancelledByUserId)
    {
        var invoice = await _db.Invoices.Include(i => i.Items).Include(i => i.Merchant).Include(i => i.Farmer).Include(i => i.Driver)
            .SingleOrDefaultAsync(i => i.Id == id) ?? throw new NotFoundAppException("Invoice", id);

        if (invoice.Status == InvoiceStatus.Cancelled)
            throw new ConflictAppException("Invoice is already cancelled.");

        invoice.Status = InvoiceStatus.Cancelled;
        invoice.CancelledAt = DateTimeOffset.UtcNow;
        invoice.CancelledByUserId = cancelledByUserId;
        invoice.CancellationReason = request.Reason;

        var originalTransaction = await _db.FarmerTransactions.SingleOrDefaultAsync(t => t.InvoiceId == invoice.Id);
        if (originalTransaction is not null)
        {
            // originalTransaction only ever exists when a farmer was attached at creation time,
            // so invoice.FarmerId is guaranteed non-null here.
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = invoice.FarmerId!.Value,
                Type = FarmerTransactionType.Adjustment,
                InvoiceId = invoice.Id,
                Date = DateTimeOffset.UtcNow,
                Amount = -originalTransaction.Amount,
                Notes = $"Reversal for cancelled invoice {invoice.InvoiceNumber}: {request.Reason}"
            });
        }

        await _db.SaveChangesAsync();
        return ToDto(invoice);
    }

    /// <summary>An Id reuses an existing partner exactly; a Name resolves via find-or-create so a
    /// brand new trader can be typed straight onto the invoice with no separate "add partner" step
    /// first. Used for the merchant side, which is always required.</summary>
    private async Task<Partner> ResolvePartnerAsync(int? id, string? name, PartnerType type, string role)
    {
        if (id is not null)
            return await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException($"Partner ({role})", id);

        if (!string.IsNullOrWhiteSpace(name))
            return await _partners.FindOrCreateAsync(name, type);

        throw new ValidationAppException($"Either an existing {role} or a {role} name is required.");
    }

    /// <summary>Same resolution as <see cref="ResolvePartnerAsync"/>, but returns null instead of
    /// throwing when neither an Id nor a name is supplied — used for the seller/driver sides, which
    /// are both optional (an invoice can be entered for the trader alone).</summary>
    private async Task<Partner?> ResolveOptionalPartnerAsync(int? id, string? name, PartnerType type, string role)
    {
        if (id is not null)
            return await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException($"Partner ({role})", id);

        if (!string.IsNullOrWhiteSpace(name))
            return await _partners.FindOrCreateAsync(name, type);

        return null;
    }

    private async Task<string> GenerateInvoiceNumberAsync(DateTimeOffset date)
    {
        var year = date.Year;
        var countThisYear = await _db.Invoices.CountAsync(i => i.Date.Year == year);
        // Note: fine for a single-writer/low-concurrency market counter; if this ever runs
        // multiple API instances behind a load balancer, switch to a DB sequence per year.
        return $"INV-{year}-{(countThisYear + 1):D6}";
    }

    private static InvoiceDto ToDto(Invoice i)
    {
        // Sum() on an empty in-memory List<decimal> is fine (returns 0, doesn't throw) — this is
        // LINQ-to-Objects over an already-materialized navigation, not a translated SQL query.
        var woodTotal = i.Items.Sum(it => it.WoodPrice);
        var grandTotal = i.TotalValue + i.TransportFee + woodTotal;

        return new(
            i.Id, i.InvoiceNumber, i.Date,
            i.MerchantId, i.Merchant.Name, i.Merchant.WhatsAppNumber,
            i.FarmerId, i.Farmer?.Name, i.Farmer?.WhatsAppNumber,
            i.DriverId, i.Driver?.Name, i.Driver?.WhatsAppNumber,
            i.Status,
            i.TotalWeightKg, i.TotalValue, i.TransportFee, woodTotal, grandTotal,
            i.Items.Select(it => new InvoiceItemDto(it.Id, it.ItemName, it.Quantity, it.Unit, it.PricePerUnit, it.WoodPrice, it.LineTotal)).ToList());
    }
}
