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
    Task<InvoiceDto> CreateAsync(CreateInvoiceRequest request, int recordedByUserId);
    Task<InvoiceDto> UpdateAsync(int id, CreateInvoiceRequest request);
    Task<InvoiceDto> GetAsync(int id);
    Task<PagedResult<InvoiceListItemDto>> ListAsync(InvoiceFilterRequest filter);
    Task<IReadOnlyList<InvoiceDto>> GetManyAsync(IReadOnlyList<int> ids);
    Task<InvoiceDto> CancelAsync(int id, CancelInvoiceRequest request, int cancelledByUserId);
    Task<FarmerStatementDto> GetFarmerStatementAsync(int farmerId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo);
    Task<FarmerGoodsDto> GetFarmerGoodsAsync(int farmerId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo);

    /// <summary>
    /// BulkPrintPage's merchant-section grouped WhatsApp send: "الرصيد السابق" for a MESSAGE that
    /// bundles several of this merchant's invoices together (same day, per the page's own
    /// same-day grouping) has to exclude ALL of them at once, not just one — reusing
    /// ComputePreviousBalanceAsync's single-id exclusion here would double-count every OTHER
    /// invoice in the same group (each one's own total would still be sitting inside "what they
    /// owe from every other Active invoice"). See ComputePreviousBalanceAsync's own doc comment.
    /// </summary>
    Task<decimal> GetMerchantGroupPreviousBalanceAsync(int merchantId, IReadOnlyList<int> invoiceIds);
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

    public async Task<InvoiceDto> CreateAsync(CreateInvoiceRequest request, int recordedByUserId)
    {
        if (request.Items is null || request.Items.Count == 0)
            throw new ValidationAppException("An invoice must have at least one item.");

        if (request.PaidAmount is < 0)
            throw new ValidationAppException("Paid amount cannot be negative.");

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
                Notes = $"تسجيل تلقائي من الفاتورة رقم {invoice.InvoiceNumber}"
            });
            await _db.SaveChangesAsync();
        }

        // Same idea as the farmer's Sale row above, but for the driver's transport fee — no driver
        // attached, or attached with TransportFee still 0, means nothing to post yet (the driver's
        // ledger only grows once there's an actual fee owed to them for this invoice).
        if (driver is not null && invoice.TransportFee > 0)
        {
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = driver.Id,
                Type = FarmerTransactionType.TransportFee,
                InvoiceId = invoice.Id,
                Date = invoice.Date,
                Amount = invoice.TransportFee,
                Notes = $"أجرة نقل تلقائية من الفاتورة {invoice.InvoiceNumber}"
            });
            await _db.SaveChangesAsync();
        }

        // Optional "المبلغ المدفوع" shortcut (see CreateInvoiceRequest.PaidAmount doc): records a
        // FromMerchant payment linked to this invoice right away, exactly as if it had been
        // entered separately on the Payments page — same PartnerService.GetMerchantAccountAsync/
        // ComputePreviousBalanceAsync below immediately reflect it.
        if (request.PaidAmount is > 0)
        {
            _db.Payments.Add(new Payment
            {
                PartnerId = merchant.Id,
                Direction = PaymentDirection.FromMerchant,
                Amount = request.PaidAmount.Value,
                Date = invoice.Date,
                InvoiceId = invoice.Id,
                Notes = $"دفعة عند إصدار الفاتورة {invoice.InvoiceNumber}",
                RecordedByUserId = recordedByUserId
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
        var previousDriverId = invoice.DriverId;

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
                Notes = $"تسجيل تلقائي من الفاتورة رقم {invoice.InvoiceNumber} (بعد التعديل)"
            });
        }

        // Same sync as the farmer's Sale row above, mirrored for the driver's TransportFee row
        // (previousDriverId was captured up front alongside previousFarmerId, before invoice.DriverId
        // got overwritten above).
        var existingTransportFee = await _db.FarmerTransactions
            .SingleOrDefaultAsync(t => t.InvoiceId == invoice.Id && t.Type == FarmerTransactionType.TransportFee);

        if (driver is null || invoice.TransportFee <= 0)
        {
            // Driver removed, or transport fee zeroed out — nothing left to post.
            if (existingTransportFee is not null) _db.FarmerTransactions.Remove(existingTransportFee);
        }
        else if (existingTransportFee is not null && previousDriverId == driver.Id)
        {
            // Same driver as before — just correct the fee/date on their existing ledger row.
            existingTransportFee.Date = invoice.Date;
            existingTransportFee.Amount = invoice.TransportFee;
            existingTransportFee.Notes = $"أجرة نقل تلقائية من الفاتورة {invoice.InvoiceNumber} (معدّلة)";
        }
        else
        {
            // Driver was added for the first time, or swapped for a different one.
            if (existingTransportFee is not null) _db.FarmerTransactions.Remove(existingTransportFee);
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = driver.Id,
                Type = FarmerTransactionType.TransportFee,
                InvoiceId = invoice.Id,
                Date = invoice.Date,
                Amount = invoice.TransportFee,
                Notes = $"أجرة نقل تلقائية من الفاتورة {invoice.InvoiceNumber} (معدّلة)"
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

        var previousBalance = await ComputePreviousBalanceAsync(invoice.MerchantId, invoice.Id);
        return ToDto(invoice, previousBalance);
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
        var result = new List<InvoiceDto>();
        foreach (var id in ids.Where(byId.ContainsKey))
        {
            var invoice = byId[id];
            var previousBalance = await ComputePreviousBalanceAsync(invoice.MerchantId, invoice.Id);
            result.Add(ToDto(invoice, previousBalance));
        }
        return result;
    }

    /// <summary>
    /// "الرصيد السابق" on a printed invoice: this merchant's manually-entered "الرصيد الافتتاحي"
    /// (Partner.OpeningBalance — money already owed before this system was in use) PLUS what they
    /// still owe from every one of their OTHER Active invoices (GrandTotal — TotalValue +
    /// TransportFee + per-line WoodPrice, same as ToDto computes for a single invoice) minus every
    /// FromMerchant payment they've ever made, all-time — never date-scoped, since the point is
    /// "what's actually still owed right now", not a snapshot frozen at some past invoice date.
    /// Clamped to 0 so a merchant who has overpaid never shows a negative "balance owed" on their
    /// next invoice (that's a credit situation, a different feature not covered here).
    ///
    /// Takes a SET of invoice ids to exclude, not just one — a single-invoice print/WhatsApp send
    /// excludes just that invoice (see the single-id overload below), but a MULTI-invoice grouped
    /// WhatsApp message (BulkPrintPage's merchant section, bundling several same-day invoices into
    /// one text) has to exclude every invoice in that whole bundle at once — otherwise each
    /// invoice's own total would still be sitting inside "every other Active invoice" and get
    /// double-counted on top of itself already being summed into the message's own grand total.
    /// </summary>
    private async Task<decimal> ComputePreviousBalanceAsync(int merchantId, IReadOnlyCollection<int> excludeInvoiceIds)
    {
        // FindAsync hits the DbContext's local tracking cache first — every caller of this method
        // already Included the Merchant navigation on the same context, so this is normally free.
        var merchant = await _db.Partners.FindAsync(merchantId);
        var openingBalance = merchant?.OpeningBalance ?? 0;

        var otherInvoices = await _db.Invoices
            .Where(i => i.MerchantId == merchantId && i.Status == InvoiceStatus.Active && !excludeInvoiceIds.Contains(i.Id))
            .Select(i => new { i.TotalValue, i.TransportFee, WoodTotal = i.Items.Sum(it => it.WoodPrice) })
            .ToListAsync();
        var totalOwed = otherInvoices.Sum(i => i.TotalValue + i.TransportFee + i.WoodTotal);

        var totalPaid = await _db.Payments
            .Where(p => p.PartnerId == merchantId && p.Direction == PaymentDirection.FromMerchant)
            .SumAsync(p => (decimal?)p.Amount) ?? 0;

        return Math.Max(0, openingBalance + totalOwed - totalPaid);
    }

    private Task<decimal> ComputePreviousBalanceAsync(int merchantId, int excludeInvoiceId) =>
        ComputePreviousBalanceAsync(merchantId, new[] { excludeInvoiceId });

    /// <summary>See the interface doc comment.</summary>
    public Task<decimal> GetMerchantGroupPreviousBalanceAsync(int merchantId, IReadOnlyList<int> invoiceIds) =>
        ComputePreviousBalanceAsync(merchantId, invoiceIds);

    public async Task<PagedResult<InvoiceListItemDto>> ListAsync(InvoiceFilterRequest filter)
    {
        var query = _db.Invoices.Include(i => i.Merchant).Include(i => i.Farmer).Include(i => i.Driver).AsQueryable();

        if (filter.DateFrom is not null) query = query.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(i => i.Date <= filter.DateTo);
        if (filter.MerchantId is not null) query = query.Where(i => i.MerchantId == filter.MerchantId);
        if (filter.FarmerId is not null) query = query.Where(i => i.FarmerId == filter.FarmerId);
        if (filter.DriverId is not null) query = query.Where(i => i.DriverId == filter.DriverId);
        if (filter.HasFarmer == true) query = query.Where(i => i.FarmerId != null);
        if (filter.HasDriver == true) query = query.Where(i => i.DriverId != null);
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
        // ItemsSummary is built in-memory (not string.Join'd inside the SQL projection below) —
        // Distinct() over a correlated collection doesn't reliably translate through the Npgsql EF
        // provider, and this only ever runs over one page of invoices (Page/PageSize), so pulling
        // each page's item names down first and joining them here is cheap and safe.
        var raw = await query.OrderByDescending(i => i.Date)
            .Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize)
            .Select(i => new
            {
                i.Id, i.InvoiceNumber, i.Date, i.MerchantId, MerchantName = i.Merchant.Name, MerchantWhatsApp = i.Merchant.WhatsAppNumber,
                i.FarmerId,
                FarmerName = i.Farmer != null ? i.Farmer.Name : null,
                FarmerWhatsApp = i.Farmer != null ? i.Farmer.WhatsAppNumber : null,
                i.DriverId,
                DriverName = i.Driver != null ? i.Driver.Name : null,
                DriverWhatsApp = i.Driver != null ? i.Driver.WhatsAppNumber : null,
                i.Status, i.TotalWeightKg,
                TotalBoxes = i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => (decimal?)it.Quantity) ?? 0,
                i.TotalValue, i.TransportFee,
                WoodTotal = i.Items.Sum(it => (decimal?)it.WoodPrice) ?? 0,
                ItemNames = i.Items.Select(it => it.ItemName).ToList()
            })
            .ToListAsync();

        // Bulk-print page's per-type sections want each invoice row to also show that row's
        // merchant/farmer/driver CURRENT overall account balance (their own كشف حساب "المتبقي" —
        // already includes their opening balance, and for a merchant, every invoice's own wood
        // total). Batched over the distinct partners on THIS page only (not one query per row), and
        // reusing PartnerService's own account methods rather than a third copy of the balance
        // formula, so this can never drift out of sync with the account pages after a future fix
        // there. Sequential awaits, not Task.WhenAll — a single EF Core DbContext can't run more
        // than one query at a time.
        var merchantIds = raw.Select(x => x.MerchantId).Distinct().ToList();
        var sellerIds = raw.Select(x => x.FarmerId).Concat(raw.Select(x => x.DriverId))
            .Where(id => id is not null).Select(id => id!.Value).Distinct().ToList();

        var merchantRemainingById = new Dictionary<int, decimal>();
        foreach (var merchantId in merchantIds)
            merchantRemainingById[merchantId] = (await _partners.GetMerchantAccountAsync(merchantId)).Remaining;

        // One dictionary covers both farmers and drivers — they share the same ledger/account method.
        var sellerRemainingById = new Dictionary<int, decimal>();
        foreach (var sellerId in sellerIds)
            sellerRemainingById[sellerId] = (await _partners.GetFarmerAccountAsync(sellerId)).Remaining;

        var items = raw.Select(x => new InvoiceListItemDto(
                x.Id, x.InvoiceNumber, x.Date, x.MerchantId, x.MerchantName, x.MerchantWhatsApp,
                x.FarmerId, x.FarmerName, x.FarmerWhatsApp, x.DriverId, x.DriverName, x.DriverWhatsApp,
                x.Status, x.TotalWeightKg, x.TotalBoxes, x.TotalValue, x.TransportFee,
                x.TotalValue + x.TransportFee + x.WoodTotal,
                string.Join("، ", x.ItemNames.Distinct()),
                x.WoodTotal,
                merchantRemainingById.GetValueOrDefault(x.MerchantId),
                x.FarmerId is not null ? sellerRemainingById.GetValueOrDefault(x.FarmerId.Value) : null,
                x.DriverId is not null ? sellerRemainingById.GetValueOrDefault(x.DriverId.Value) : null))
            .ToList();

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

        // Up to TWO original rows now (was at most one): a Sale row for the farmer and/or a
        // TransportFee row for the driver (see Invoice.FarmerTransactions) — each gets its own
        // offsetting Adjustment, keyed off THAT row's own FarmerId (the farmer's id on a Sale row,
        // the driver's id on a TransportFee row), not invoice.FarmerId, which would be null/wrong
        // for the driver's row.
        var originalTransactions = await _db.FarmerTransactions.Where(t => t.InvoiceId == invoice.Id).ToListAsync();
        foreach (var originalTransaction in originalTransactions)
        {
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = originalTransaction.FarmerId,
                Type = FarmerTransactionType.Adjustment,
                InvoiceId = invoice.Id,
                Date = DateTimeOffset.UtcNow,
                Amount = -originalTransaction.Amount,
                Notes = $"إلغاء فاتورة رقم {invoice.InvoiceNumber} — السبب: {request.Reason}"
            });
        }

        await _db.SaveChangesAsync();
        var previousBalance = await ComputePreviousBalanceAsync(invoice.MerchantId, invoice.Id);
        return ToDto(invoice, previousBalance);
    }

    /// <summary>
    /// Bulk-print page's "كشف بائع" section: every item line off this farmer's own Active invoices
    /// within the picked date range (inclusive), ordered oldest-first so the printed statement
    /// reads chronologically. Farmer name is resolved directly via Partners rather than requiring
    /// at least one matching invoice, so the caller still gets a proper "لا توجد فواتير..." message
    /// (farmer exists, just nothing in range) instead of a bare 404.
    /// </summary>
    public async Task<FarmerStatementDto> GetFarmerStatementAsync(int farmerId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo)
    {
        var farmer = await _db.Partners.FindAsync(farmerId) ?? throw new NotFoundAppException("Partner (farmer)", farmerId);

        var query = _db.Invoices
            .Where(i => i.FarmerId == farmerId && i.Status == InvoiceStatus.Active);
        if (dateFrom is not null) query = query.Where(i => i.Date >= dateFrom);
        if (dateTo is not null) query = query.Where(i => i.Date <= dateTo);

        var invoices = await query
            .Include(i => i.Items)
            .OrderBy(i => i.Date)
            .ToListAsync();

        // In-memory flatten (not SelectMany translated to SQL) so the per-invoice date ordering
        // above is guaranteed to carry through to the flattened item rows.
        var lines = invoices
            .SelectMany(i => i.Items.Select(it => new FarmerStatementLineDto(
                i.Date, it.ItemName, it.Quantity, it.Unit, it.PricePerUnit, it.WoodPrice, it.LineTotal)))
            .ToList();

        return new FarmerStatementDto(farmer.Id, farmer.Name, lines);
    }

    /// <summary>
    /// Standalone "بضاعة الباعة" page: what this farmer brought, grouped by day + item + unit,
    /// across his own Active invoices within the (optional) date range — see FarmerGoodsRow's doc
    /// comment for exactly what TotalQuantity/WoodQuantity mean. Grouped in memory (not via SQL
    /// GroupBy) since it's keyed on the invoice's calendar DAY, not its exact timestamp, and on the
    /// already-materialized item rows — simplest to just flatten first, then group with LINQ.
    /// </summary>
    public async Task<FarmerGoodsDto> GetFarmerGoodsAsync(int farmerId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo)
    {
        var farmer = await _db.Partners.FindAsync(farmerId) ?? throw new NotFoundAppException("Partner (farmer)", farmerId);

        var query = _db.Invoices
            .Where(i => i.FarmerId == farmerId && i.Status == InvoiceStatus.Active);
        if (dateFrom is not null) query = query.Where(i => i.Date >= dateFrom);
        if (dateTo is not null) query = query.Where(i => i.Date <= dateTo);

        var invoices = await query.Include(i => i.Items).ToListAsync();

        var rows = invoices
            .SelectMany(i => i.Items.Select(it => new { Day = i.Date.Date, it.ItemName, it.Unit, it.Quantity, it.WoodPrice }))
            .GroupBy(x => new { x.Day, x.ItemName, x.Unit })
            .Select(g => new FarmerGoodsRow(
                g.Key.Day, g.Key.ItemName, g.Key.Unit,
                g.Sum(x => x.Quantity),
                g.Where(x => x.WoodPrice > 0).Sum(x => x.Quantity)))
            .OrderBy(r => r.Date).ThenBy(r => r.ItemName)
            .ToList();

        return new FarmerGoodsDto(farmer.Id, farmer.Name, rows);
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

    private static InvoiceDto ToDto(Invoice i, decimal previousBalance)
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
            previousBalance,
            i.Items.Select(it => new InvoiceItemDto(it.Id, it.ItemName, it.Quantity, it.Unit, it.PricePerUnit, it.WoodPrice, it.LineTotal)).ToList());
    }
}
