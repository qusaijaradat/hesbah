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

    /// <summary>See the implementation's own doc comment — soft-delete, not a DB row removal.</summary>
    Task DeleteAsync(int id);
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

        // Previously unchecked — a negative value here flowed straight into GrandTotal and the
        // driver's FarmerTransaction Amount, quietly reducing what the driver is shown as owed.
        if (request.TransportFee < 0)
            throw new ValidationAppException("أجرة النقل لا يمكن أن تكون قيمة سالبة.");


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

        var commissionRate = await _settings.GetDecimalAsync(Setting.Keys.DefaultCommissionRate, 0.10m);
        var commissionResult = CommissionCalculator.Calculate(totals.TotalValue, commissionRate);
        // Automatic "سعر الصندوق" fee (explicit request, separate from/additive to the manual
        // per-line WoodPrice) — locked in NOW so a later change to the settings value never
        // retroactively alters this invoice; the actual fee (TotalBoxes × this rate) is computed
        // fresh on every read, not stored (see Invoice.BoxPriceApplied's own doc comment).
        var boxPrice = await _settings.GetDecimalAsync(Setting.Keys.BoxPrice, 0m);
        // Driver-side counterpart (explicit request) — money owed TO the driver, locked in the
        // same way; see Invoice.DriverBoxFeeApplied's own doc comment. Computed now (rather than
        // only inside ToDto) because it needs to be folded into the driver's FarmerTransaction
        // Amount right below.
        var driverBoxFee = await _settings.GetDecimalAsync(Setting.Keys.DriverBoxFee, 0m);
        var driverBoxFeeTotal = totals.TotalBoxes * driverBoxFee;


        var invoice = new Invoice
        {
            Date = request.Date,
            MerchantId = merchant.Id,
            FarmerId = farmer?.Id,
            DriverId = driver?.Id,
            TransportFee = request.TransportFee,
            Status = InvoiceStatus.Active,
            TotalWeightKg = totals.TotalWeightKg,
            TotalValue = totals.TotalValue,
            CommissionRateApplied = commissionRate,
            BoxPriceApplied = boxPrice,
            DriverBoxFeeApplied = driverBoxFee,
            // What the buyer is charged, stored once here and kept in step by RecomputeGrandTotal
            // on every later edit/return — see Invoice.GrandTotal for why it is stored at all.
            // A brand-new invoice has no returns yet, hence 0.
            GrandTotal = InvoiceCharge.ForMerchant(
                totals.TotalValue, request.TransportFee, totals.WoodTotal,
                totals.TotalBoxes * boxPrice, returnsTotal: 0m),
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

        // The invoice row, its farmer ledger row, its driver ledger row, and its optional
        // "paid at issuance" payment row below are up to FOUR separate SaveChangesAsync calls
        // (each later one needs invoice.Id/payment linkage from the one before it) — wrapped in
        // one DB transaction so an interruption partway through can never leave an invoice saved
        // without its matching ledger rows, which is exactly the atomicity this method's own
        // class-level doc comment already promises.
        await using var transaction = await _db.Database.BeginTransactionAsync();

        // GenerateInvoiceNumberAsync picks the next number by counting existing rows for the year
        // — two requests landing at nearly the same moment can compute the same "next" number, and
        // the unique index on InvoiceNumber then rejected the loser as an unhandled 500 instead of
        // a clear retry. A savepoint lets just the failed insert be undone and retried with a fresh
        // number, without losing the outer transaction (and everything already staged in it).
        const int maxInvoiceNumberAttempts = 5;
        for (var attempt = 1; ; attempt++)
        {
            invoice.InvoiceNumber = await GenerateInvoiceNumberAsync(request.Date);
            await transaction.CreateSavepointAsync("before_invoice_insert");
            try
            {
                _db.Invoices.Add(invoice);
                await _db.SaveChangesAsync(); // need invoice.Id before creating the linked ledger row
                break;
            }
            catch (DbUpdateException) when (attempt < maxInvoiceNumberAttempts)
            {
                await transaction.RollbackToSavepointAsync("before_invoice_insert");
                // Clears every tracked entity, not just the invoice — Add() also cascaded onto
                // invoice.Items, and detaching only the parent would leave those still tracked as
                // Added on the retry's second Add() call. Safe here: only merchant.Id/farmer.Id/
                // driver.Id (plain values, not the tracked references) are still needed below.
                _db.ChangeTracker.Clear();
            }
        }

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
                // "سعر الخشب" is NOT part of this: the crates are not the seller's to be paid for.
                // The buyer is charged for them once and that money goes to the driver, who is the
                // side that supplies and handles them (see the driver's own ledger row below).
                // Adding it here as well was paying a single charge out twice — see ToDto's
                // NetDueToFarmer for the read-side mirror of this.
                Amount = commissionResult.NetDueToFarmer,
                Notes = $"تسجيل تلقائي من الفاتورة رقم {invoice.InvoiceNumber}"
            });
            await _db.SaveChangesAsync();
        }

        // Same idea as the farmer's Sale row above, but for the driver's transport fee — no driver
        // attached, or attached with neither a transport fee, a box-handling fee, nor a wood-price
        // total, means nothing to post yet (the driver's ledger only grows once there's an actual
        // amount owed to them for this invoice). Amount folds in driverBoxFeeTotal AND totals.WoodTotal
        // (explicit requirement: the full wood-price amount is paid to the driver too, on top of what
        // the merchant is separately charged for it) so the driver's account/statement/reports/manifest
        // automatically reflect both alongside the manual transport fee, without a separate ledger row.
        if (driver is not null && (invoice.TransportFee > 0 || driverBoxFeeTotal > 0 || totals.WoodTotal > 0))
        {
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = driver.Id,
                Type = FarmerTransactionType.TransportFee,
                InvoiceId = invoice.Id,
                Date = invoice.Date,
                Amount = invoice.TransportFee + driverBoxFeeTotal + totals.WoodTotal,
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

        await transaction.CommitAsync();
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

        if (request.TransportFee < 0)
            throw new ValidationAppException("أجرة النقل لا يمكن أن تكون قيمة سالبة.");


        // PaidAmount only ever means "record an automatic payment right now" (see CreateAsync) —
        // there's no sensible "automatic payment" moment on an edit, and silently doing nothing
        // with it left staff assuming a payment was recorded when it wasn't. Rejecting it here with
        // a clear message replaces that silent no-op; the payment can still be recorded normally
        // from the Payments page.
        if (request.PaidAmount is > 0)
            throw new ValidationAppException("لا يمكن تسجيل \"مبلغ مدفوع عند الإصدار\" عند تعديل فاتورة — سجّل الدفعة من شاشة الدفعات بدلاً من ذلك.");

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

        var commissionRate = await _settings.GetDecimalAsync(Setting.Keys.DefaultCommissionRate, 0.10m);
        var commissionResult = CommissionCalculator.Calculate(totals.TotalValue, commissionRate);
        // Same re-lock-on-edit behavior as CommissionRateApplied below — an edit re-reads the
        // CURRENT settings value, same tradeoff already accepted for the commission rate.
        var boxPrice = await _settings.GetDecimalAsync(Setting.Keys.BoxPrice, 0m);
        // Driver-side counterpart — see CreateAsync's own comment for why this is computed here
        // rather than only inside ToDto.
        var driverBoxFee = await _settings.GetDecimalAsync(Setting.Keys.DriverBoxFee, 0m);
        var driverBoxFeeTotal = totals.TotalBoxes * driverBoxFee;


        // A return is checked against what was sold at the moment it is recorded (see
        // GoodsReturnService) — and that check only ever ran once. This edit rewrites the very
        // lines it was checked against, so the same invariant is re-checked here: goods that came
        // back must still be goods this invoice says went out, and their value must still fit
        // inside it. Without this, editing an invoice down after a return pushes GrandTotal
        // negative — the buyer shows up as owed money by the market — and leaves a return
        // pointing at quantities the invoice no longer contains.
        var existingReturns = await _db.GoodsReturns
            .Include(r => r.Items)
            .Where(r => r.InvoiceId == invoice.Id)
            .ToListAsync();
        if (existingReturns.Count > 0)
        {
            // Same trimmed/case-insensitive (name, unit) key GoodsReturnService matches on —
            // invoice item names are free text, not a foreign key into the catalog.
            static string Key(string name, UnitOfMeasure unit) => $"{name.Trim().ToLowerInvariant()}|{unit}";

            var newSoldByKey = totals.Lines
                .GroupBy(l => Key(l.ItemName, l.Unit))
                .ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity));

            foreach (var group in existingReturns.SelectMany(r => r.Items).GroupBy(ri => Key(ri.ItemName, ri.Unit)))
            {
                var returned = group.Sum(ri => ri.Quantity);
                var stillSold = newSoldByKey.GetValueOrDefault(group.Key);
                if (returned > stillSold)
                    throw new ValidationAppException(
                        $"لا يمكن حفظ التعديل: الكمية المرتجعة من \"{group.First().ItemName.Trim()}\" ({returned:0.###}) أكبر من الكمية على الفاتورة بعد التعديل ({stillSold:0.###}). عدّل المرتجع أو احذفه أولًا.");
            }

            // And in money, so a price edit cannot leave the returns worth more than the goods.
            // TotalValue is the right ceiling rather than the full charge: a return is of GOODS,
            // and transport/wood/box fees are not returnable. Keeping returnsTotal within it also
            // keeps GrandTotal at or above zero, since every other term it adds is non-negative.
            var returnsTotal = existingReturns.Sum(r => r.TotalValue);
            if (returnsTotal > totals.TotalValue)
                throw new ValidationAppException(
                    $"لا يمكن حفظ التعديل: قيمة المرتجعات ({returnsTotal:0.##}) أكبر من قيمة البضاعة بعد التعديل ({totals.TotalValue:0.##}). عدّل المرتجع أو احذفه أولًا.");
        }

        var previousMerchantId = invoice.MerchantId;
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
        invoice.BoxPriceApplied = boxPrice;
        invoice.DriverBoxFeeApplied = driverBoxFee;
        // Recomputed from the edited lines/fees, keeping whatever has already been returned
        // against this invoice subtracted (an edit must never quietly un-return goods).
        invoice.GrandTotal = InvoiceCharge.ForMerchant(
            totals.TotalValue, request.TransportFee, totals.WoodTotal,
            totals.TotalBoxes * boxPrice,
            await _db.GoodsReturns.Where(r => r.InvoiceId == invoice.Id).SumAsync(r => (decimal?)r.TotalValue) ?? 0m);

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
            // Amount carries no wood, same as CreateAsync — see its own comment.
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

        if (driver is null || (invoice.TransportFee <= 0 && driverBoxFeeTotal <= 0 && totals.WoodTotal <= 0))
        {
            // Driver removed, or the transport fee, box-handling fee, AND wood-price total all
            // zeroed out — nothing left to post.
            if (existingTransportFee is not null) _db.FarmerTransactions.Remove(existingTransportFee);
        }
        else if (existingTransportFee is not null && previousDriverId == driver.Id)
        {
            // Same driver as before — just correct the fee/date on their existing ledger row.
            // Amount folds in driverBoxFeeTotal and totals.WoodTotal, same as CreateAsync — see its
            // own comment.
            existingTransportFee.Date = invoice.Date;
            existingTransportFee.Amount = invoice.TransportFee + driverBoxFeeTotal + totals.WoodTotal;
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
                Amount = invoice.TransportFee + driverBoxFeeTotal + totals.WoodTotal,
                Notes = $"أجرة نقل تلقائية من الفاتورة {invoice.InvoiceNumber} (معدّلة)"
            });
        }

        // Merchant swapped for someone else — any payment already linked to THIS invoice (Payments
        // page's "ربط بفاتورة محددة") was reducing the OLD merchant's balance, and would keep doing
        // so forever even though the invoice is now billed to a different person. Move those
        // payments onto the new merchant so the balance follows the corrected invoice, not the
        // original typo.
        if (previousMerchantId != merchant.Id)
        {
            var linkedPayments = await _db.Payments
                .Where(p => p.InvoiceId == invoice.Id && p.Direction == PaymentDirection.FromMerchant)
                .ToListAsync();
            foreach (var linkedPayment in linkedPayments)
                linkedPayment.PartnerId = merchant.Id;
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
            .Select(i => new { i.GrandTotal })
            .ToListAsync();
        var totalOwed = otherInvoices.Sum(i => i.GrandTotal);

        // Only cleared checks count (see PaymentRules) — a check still قيد التحصيل, or one that
        // came back, never actually paid anything, so it must not make the printed "previous
        // balance" understate what's still owed.
        var totalPaid = await _db.Payments
            .Where(PaymentRules.CountsTowardBalanceExpression)
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
        // Same unbounded-pageSize gap as Expense/Partner/Item/Payment services — but BulkPrintPage
        // deliberately requests pageSize=500 for a print run, and ExportExcel below requests up to
        // 50,000 for a full filtered export, so the ceiling here is set well above both instead of
        // the usual 200, to avoid silently truncating either legitimate use.
        (filter.Page, filter.PageSize) = Paging.Clamp(filter.Page, filter.PageSize, maxPageSize: 50_000);

        var query = _db.Invoices.Include(i => i.Merchant).Include(i => i.Farmer).Include(i => i.Driver).AsQueryable();

        if (filter.DateFrom is not null) query = query.Where(i => i.Date >= filter.DateFrom);
        if (filter.DateTo is not null) query = query.Where(i => i.Date <= filter.DateTo);
        if (filter.MerchantId is not null) query = query.Where(i => i.MerchantId == filter.MerchantId);
        if (filter.FarmerId is not null) query = query.Where(i => i.FarmerId == filter.FarmerId);
        if (filter.DriverId is not null) query = query.Where(i => i.DriverId == filter.DriverId);
        if (filter.HasFarmer == true) query = query.Where(i => i.FarmerId != null);
        if (filter.HasDriver == true) query = query.Where(i => i.DriverId != null);
        // "استثناء أسماء" (see InvoiceFilterRequest.ExcludeMerchantIds' doc comment). Held in
        // locals so the lambdas capture the list itself rather than the filter object, and so the
        // nullable-column cases can spell out "no farmer attached at all still passes" explicitly
        // instead of relying on how SQL's NOT IN treats NULL.
        if (filter.ExcludeMerchantIds is { Count: > 0 } excludedMerchants)
            query = query.Where(i => !excludedMerchants.Contains(i.MerchantId));
        if (filter.ExcludeFarmerIds is { Count: > 0 } excludedFarmers)
            query = query.Where(i => i.FarmerId == null || !excludedFarmers.Contains(i.FarmerId.Value));
        if (filter.ExcludeDriverIds is { Count: > 0 } excludedDrivers)
            query = query.Where(i => i.DriverId == null || !excludedDrivers.Contains(i.DriverId.Value));
        if (filter.Status is not null) query = query.Where(i => i.Status == filter.Status);
        if (!string.IsNullOrWhiteSpace(filter.InvoiceNumber)) query = query.Where(i => i.InvoiceNumber.Contains(filter.InvoiceNumber));
        if (!string.IsNullOrWhiteSpace(filter.InvoiceNumberFrom)) query = query.Where(i => i.InvoiceNumber.CompareTo(filter.InvoiceNumberFrom) >= 0);
        if (!string.IsNullOrWhiteSpace(filter.InvoiceNumberTo)) query = query.Where(i => i.InvoiceNumber.CompareTo(filter.InvoiceNumberTo) <= 0);
        if (filter.CreatedByUserId is not null) query = query.Where(i => i.CreatedByUserId == filter.CreatedByUserId);
        if (filter.MinWeightKg is not null) query = query.Where(i => i.TotalWeightKg >= filter.MinWeightKg);
        if (filter.MaxWeightKg is not null) query = query.Where(i => i.TotalWeightKg <= filter.MaxWeightKg);
        if (filter.MinAmount is not null) query = query.Where(i => i.TotalValue >= filter.MinAmount);
        if (filter.MaxAmount is not null) query = query.Where(i => i.TotalValue <= filter.MaxAmount);
        // "فيها أصناف غير مسعّرة" — a correlated Any() over the lines, translated to an EXISTS.
        if (filter.HasUnpricedItems == true)
            query = query.Where(i => i.Items.Any(it => it.PricePerUnit == 0));

        // Payment status. Compared against the STORED GrandTotal and the invoice's own linked
        // payments, so this is one translated query rather than loading every invoice to sort
        // them in memory — which matters precisely because the list is paged by the server.
        // "Paid" is >= (not ==) so an overpayment still reads as settled.
        if (filter.PaymentStatus is not null)
        {
            var status = filter.PaymentStatus.Value;
            query = status switch
            {
                InvoicePaymentStatus.Unpaid => query.Where(i =>
                    i.Payments.Where(pm => pm.CheckStatus == null || pm.CheckStatus == CheckClearanceStatus.Cleared)
                        .Sum(pm => (decimal?)pm.Amount) == null
                    || i.Payments.Where(pm => pm.CheckStatus == null || pm.CheckStatus == CheckClearanceStatus.Cleared)
                        .Sum(pm => (decimal?)pm.Amount) == 0),
                InvoicePaymentStatus.Paid => query.Where(i =>
                    (i.Payments.Where(pm => pm.CheckStatus == null || pm.CheckStatus == CheckClearanceStatus.Cleared)
                        .Sum(pm => (decimal?)pm.Amount) ?? 0) >= i.GrandTotal),
                _ => query.Where(i =>
                    (i.Payments.Where(pm => pm.CheckStatus == null || pm.CheckStatus == CheckClearanceStatus.Cleared)
                        .Sum(pm => (decimal?)pm.Amount) ?? 0) > 0
                    && (i.Payments.Where(pm => pm.CheckStatus == null || pm.CheckStatus == CheckClearanceStatus.Cleared)
                        .Sum(pm => (decimal?)pm.Amount) ?? 0) < i.GrandTotal),
            };
        }

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
                i.BoxPriceApplied,
                // Both rates are locked in per invoice at creation time — pulled here so the
                // farmer-side and driver-side figures below can be derived per row.
                i.CommissionRateApplied,
                i.DriverBoxFeeApplied,
                i.GrandTotal,
                ReturnsTotal = i.Returns.Sum(r => (decimal?)r.TotalValue) ?? 0,
                // Only payments that actually moved money — the same rule as every balance in
                // the app (PaymentRules), spelled out inline because a translated projection
                // can't call into it.
                PaidAmount = i.Payments
                    .Where(pm => pm.CheckStatus == null || pm.CheckStatus == CheckClearanceStatus.Cleared)
                    .Sum(pm => (decimal?)pm.Amount) ?? 0,
                HasUnpricedItems = i.Items.Any(it => it.PricePerUnit == 0),
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

        var items = raw.Select(x =>
        {
            // Same "TotalBoxes × BoxPriceApplied, computed fresh" treatment as InvoiceService.ToDto.
            var boxFeeTotal = x.TotalBoxes * x.BoxPriceApplied;
            // Farmer-side and driver-side money, derived exactly the way ToDto derives them for a
            // single invoice — through CommissionCalculator rather than a second inline formula,
            // so a list row can never disagree with the invoice's own DTO, its printed copy, or
            // the partner's ledger. See InvoiceListItemDto's doc comment.
            var commissionResult = CommissionCalculator.Calculate(x.TotalValue, x.CommissionRateApplied);
            var driverBoxFeeTotal = x.TotalBoxes * x.DriverBoxFeeApplied;
            return new InvoiceListItemDto(
                x.Id, x.InvoiceNumber, x.Date, x.MerchantId, x.MerchantName, x.MerchantWhatsApp,
                x.FarmerId, x.FarmerName, x.FarmerWhatsApp, x.DriverId, x.DriverName, x.DriverWhatsApp,
                x.Status, x.TotalWeightKg, x.TotalBoxes, x.TotalValue, x.TransportFee,
                x.GrandTotal,
                string.Join("، ", x.ItemNames.Distinct()),
                x.WoodTotal, boxFeeTotal,
                merchantRemainingById.GetValueOrDefault(x.MerchantId),
                x.FarmerId is not null ? sellerRemainingById.GetValueOrDefault(x.FarmerId.Value) : null,
                x.DriverId is not null ? sellerRemainingById.GetValueOrDefault(x.DriverId.Value) : null,
                commissionResult.Commission, commissionResult.NetDueToFarmer,
                driverBoxFeeTotal, x.TransportFee + driverBoxFeeTotal + x.WoodTotal,
                x.ReturnsTotal,
                x.PaidAmount, x.GrandTotal - x.PaidAmount,
                x.PaidAmount <= 0 ? InvoicePaymentStatus.Unpaid
                    : x.PaidAmount >= x.GrandTotal ? InvoicePaymentStatus.Paid
                    : InvoicePaymentStatus.Partial,
                x.HasUnpricedItems);
        }).ToList();

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

        // Any payment linked to this invoice was real money already received/paid — cancelling the
        // invoice must never make it vanish, but it also must not keep sitting attached to a total
        // that no longer exists (previously it did exactly that: the invoice's own charge stopped
        // counting once cancelled, while the linked payment kept reducing the partner's balance
        // forever with nothing on the invoice itself explaining why). Unlinking it here means it
        // still counts as a general credit against the partner's overall balance (exactly how an
        // unlinked payment already behaves everywhere else), and the note makes the reason visible
        // wherever that payment shows up (statements, the Payments list) instead of a silent drop.
        var linkedPayments = await _db.Payments.Where(p => p.InvoiceId == invoice.Id).ToListAsync();
        foreach (var linkedPayment in linkedPayments)
        {
            linkedPayment.InvoiceId = null;
            var cancellationNote = $"كانت مرتبطة بالفاتورة رقم {invoice.InvoiceNumber} — أُلغيت الفاتورة، والدفعة باقية كرصيد عام";
            linkedPayment.Notes = string.IsNullOrWhiteSpace(linkedPayment.Notes)
                ? cancellationNote
                : $"{linkedPayment.Notes} ({cancellationNote})";
        }

        await _db.SaveChangesAsync();
        var previousBalance = await ComputePreviousBalanceAsync(invoice.MerchantId, invoice.Id);
        return ToDto(invoice, previousBalance);
    }

    /// <summary>
    /// "حذف" from the invoices list — takes the invoice off every screen at once (the list, the
    /// merchant's account, the farmer's/driver's ledger, statements, reports), for a row entered
    /// by mistake that shouldn't be sitting there as a visible "ملغاة" line at all. Deliberately
    /// NOT the same action as <see cref="CancelAsync"/>, which keeps the invoice on the books with
    /// an offsetting Adjustment and a stated reason.
    ///
    /// Never an actual row removal: the invoice is flagged <c>IsDeleted</c>, which the global query
    /// filter (see AppDbContext) then hides from every query in the app, so the row — with its
    /// items and its audit history — survives for reconciliation. Its FarmerTransaction rows ARE
    /// removed outright, though: they carry no soft-delete flag of their own and are read straight
    /// off the farmer/driver ledger without ever joining Invoices, so leaving them would keep a
    /// deleted invoice's Sale/TransportFee amounts in those accounts forever. Same removal
    /// PaymentService.DeleteAsync already does for a payment's own ledger row. On an
    /// already-cancelled invoice this also clears the Adjustment rows cancelling it added (they're
    /// keyed to the same InvoiceId), which is right — the pair nets to zero anyway.
    ///
    /// Linked payments are unlinked, not deleted, for exactly the reason CancelAsync spells out:
    /// that was real money received/paid, so it stays as a general credit against the partner's
    /// balance, with a note saying where it came from. Everything below lands in ONE
    /// SaveChangesAsync (hence one DB transaction), so a failure can't half-apply the delete.
    /// </summary>
    public async Task DeleteAsync(int id)
    {
        var invoice = await _db.Invoices.SingleOrDefaultAsync(i => i.Id == id)
            ?? throw new NotFoundAppException("Invoice", id);

        var ledgerRows = await _db.FarmerTransactions.Where(t => t.InvoiceId == invoice.Id).ToListAsync();
        _db.FarmerTransactions.RemoveRange(ledgerRows);

        var linkedPayments = await _db.Payments.Where(p => p.InvoiceId == invoice.Id).ToListAsync();
        foreach (var linkedPayment in linkedPayments)
        {
            linkedPayment.InvoiceId = null;
            var deletionNote = $"كانت مرتبطة بالفاتورة رقم {invoice.InvoiceNumber} — حُذفت الفاتورة، والدفعة باقية كرصيد عام";
            linkedPayment.Notes = string.IsNullOrWhiteSpace(linkedPayment.Notes)
                ? deletionNote
                : $"{linkedPayment.Notes} ({deletionNote})";
        }

        invoice.IsDeleted = true;
        await _db.SaveChangesAsync();
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
                i.Date, it.ItemName, it.Quantity, it.Unit, it.PricePerUnit, it.WoodPrice, it.LineTotal, i.CommissionRateApplied)))
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

    /// <summary>An Id reuses an existing partner exactly — but only after checking it's actually
    /// the right kind of partner for this role (see PartnerTypeMatches's doc comment); previously
    /// any partner id was accepted as-is, so a merchant id passed as FarmerId would silently get
    /// charged a commission and posted onto the farmer ledger. A Name resolves via find-or-create
    /// so a brand new trader can be typed straight onto the invoice with no separate "add partner"
    /// step first. Used for the merchant side, which is always required.</summary>
    private async Task<Partner> ResolvePartnerAsync(int? id, string? name, PartnerType type, string role)
    {
        if (id is not null)
        {
            var existing = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException($"Partner ({role})", id);
            if (!PartnerTypeMatches(existing.Type, type))
                throw new ValidationAppException($"الشخص المحدد ({existing.Name}) ليس من نوع {PartnerTypeLabel(type)} — لا يمكن استخدامه كـ{role} على هذه الفاتورة.");
            return existing;
        }

        if (!string.IsNullOrWhiteSpace(name))
            return await _partners.FindOrCreateAsync(name, type);

        throw new ValidationAppException($"Either an existing {role} or a {role} name is required.");
    }

    /// <summary>Same "Both" allowance used everywhere a partner's type is checked (see
    /// PartnerService.ListAsync's sellerIds/merchantIds grouping and PaymentService's own copy of
    /// this same check): a partner marked Both can act as either Farmer or Merchant, since that's
    /// exactly what Both means (requirement doc §3). Driver is its own type, never folded into
    /// Both, so only an actual Driver partner satisfies a Driver expectation. Partner.Type itself
    /// is nullable (staff can record a person before knowing their role — see
    /// PartnerService.ValidateNameAndType/PartnersPage's "النوع (اختياري)" field): a still-unset
    /// Type can't fail this check without also blocking that pre-existing, intentional flow, so it
    /// is passed through here rather than rejected.</summary>
    private static bool PartnerTypeMatches(PartnerType? actual, PartnerType expected) => actual is null || expected switch
    {
        PartnerType.Farmer => actual is PartnerType.Farmer or PartnerType.Both,
        PartnerType.Merchant => actual is PartnerType.Merchant or PartnerType.Both,
        PartnerType.Driver => actual is PartnerType.Driver,
        _ => actual == expected
    };

    private static string PartnerTypeLabel(PartnerType type) => type switch
    {
        PartnerType.Farmer => "بائع",
        PartnerType.Merchant => "مشتري",
        PartnerType.Driver => "سائق",
        _ => type.ToString()
    };

    /// <summary>Same resolution as <see cref="ResolvePartnerAsync"/>, but returns null instead of
    /// throwing when neither an Id nor a name is supplied — used for the seller/driver sides, which
    /// are both optional (an invoice can be entered for the trader alone).</summary>
    private async Task<Partner?> ResolveOptionalPartnerAsync(int? id, string? name, PartnerType type, string role)
    {
        if (id is not null)
        {
            var existing = await _db.Partners.FindAsync(id) ?? throw new NotFoundAppException($"Partner ({role})", id);
            if (!PartnerTypeMatches(existing.Type, type))
                throw new ValidationAppException($"الشخص المحدد ({existing.Name}) ليس من نوع {PartnerTypeLabel(type)} — لا يمكن استخدامه كـ{role} على هذه الفاتورة.");
            return existing;
        }

        if (!string.IsNullOrWhiteSpace(name))
            return await _partners.FindOrCreateAsync(name, type);

        return null;
    }

    /// <summary>
    /// Next human-facing number for the year: one past the HIGHEST already issued, read across
    /// every row including soft-deleted and cancelled ones.
    ///
    /// This used to COUNT the year's invoices instead, which broke the moment invoices could be
    /// deleted. The count runs through the global soft-delete filter, but the unique index on
    /// InvoiceNumber does not — so a deleted invoice stopped being counted while still occupying
    /// its number. Delete one invoice out of ten and the next one is assigned INV-yyyy-000010,
    /// which invoice #10 still holds: the insert violates the unique index, and because every
    /// retry recomputes the same number, invoice creation stays broken rather than failing once.
    ///
    /// Taking the maximum instead is immune to that: numbers are only ever consumed, never freed,
    /// so a gap left by a deleted or cancelled invoice stays a gap rather than being handed out a
    /// second time — which is also what anyone reading a numbered sequence of invoices expects.
    ///
    /// Still not safe against two API instances issuing at the same instant (the max is read
    /// before the insert). Unchanged from before, and fine for a single-writer market counter; a
    /// per-year DB sequence is the fix if this is ever load-balanced.
    /// </summary>
    private async Task<string> GenerateInvoiceNumberAsync(DateTimeOffset date)
    {
        var year = date.Year;
        var prefix = $"INV-{year}-";

        // IgnoreQueryFilters is the whole point: a soft-deleted invoice keeps its number, so the
        // number generator has to be able to see it.
        var numbersThisYear = await _db.Invoices
            .IgnoreQueryFilters()
            .Where(i => i.InvoiceNumber.StartsWith(prefix))
            .Select(i => i.InvoiceNumber)
            .ToListAsync();

        // Parsed in memory rather than in SQL — the suffix is a fixed-width zero-padded tail, and
        // an unparsable one (hand-edited, imported from an older scheme) is skipped rather than
        // taking the whole sequence down with it.
        var highest = numbersThisYear
            .Select(n => int.TryParse(n[prefix.Length..], out var value) ? value : 0)
            .DefaultIfEmpty(0)
            .Max();

        return $"{prefix}{(highest + 1):D6}";
    }

    private static InvoiceDto ToDto(Invoice i, decimal previousBalance)
    {
        // Sum() on an empty in-memory List<decimal> is fine (returns 0, doesn't throw) — this is
        // LINQ-to-Objects over an already-materialized navigation, not a translated SQL query.
        var woodTotal = i.Items.Sum(it => it.WoodPrice);
        // Automatic "سعر الصندوق" fee — box-unit item count × the rate locked in on THIS invoice
        // at creation time (i.BoxPriceApplied), computed fresh here rather than stored, same
        // treatment as woodTotal above. Separate from/additive to woodTotal.
        var totalBoxes = i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Sum(it => it.Quantity);
        var boxFeeTotal = totalBoxes * i.BoxPriceApplied;
        // Driver-side counterpart — box-unit item count × the rate locked in on THIS invoice at
        // creation time (i.DriverBoxFeeApplied), same "computed fresh, never stored" treatment.
        // Deliberately excluded from grandTotal below (merchant-facing) — see InvoiceDto's own doc
        // comment.
        var driverBoxFeeTotal = totalBoxes * i.DriverBoxFeeApplied;
        // Read, not re-derived: Invoice.GrandTotal is the one authoritative charge (it also nets
        // out any returns, which this expression never did) — see InvoiceCharge.
        var grandTotal = i.GrandTotal;

        // Settlement, per invoice. Only payments that actually moved money count (an uncleared
        // check has not — see PaymentRules), matching every balance elsewhere in the app.
        var returnsTotal = i.Returns.Sum(r => r.TotalValue);
        var paidAmount = i.Payments.Where(pm => PaymentRules.CountsTowardBalance(pm.CheckStatus)).Sum(pm => pm.Amount);
        // ">=" not "==" so an overpayment still reads as settled rather than falling into Partial.
        var paymentStatus = paidAmount <= 0 ? InvoicePaymentStatus.Unpaid
            : paidAmount >= grandTotal ? InvoicePaymentStatus.Paid
            : InvoicePaymentStatus.Partial;

        // Same base as the linked FarmerTransaction.Commission (TotalValue only — never +wood/
        // +transport/+box, see CommissionCalculator's own doc comment) so the COMMISSION itself can
        // never drift from the farmer's own ledger. NetDueToFarmer carries no wood — the crates are
        // not the seller's to be paid for, they are the driver's (see FarmerTransaction.Amount in
        // CreateAsync/UpdateAsync) — so THIS never drifts from the farmer's own ledger row either.
        // Computed even without a farmer attached (harmless/unused then) — see InvoiceDto's own doc
        // comment for where this is and isn't shown.
        var commissionResult = CommissionCalculator.Calculate(i.TotalValue, i.CommissionRateApplied);
        var netDueToFarmer = commissionResult.NetDueToFarmer;

        return new(
            i.Id, i.InvoiceNumber, i.Date,
            i.MerchantId, i.Merchant.Name, i.Merchant.WhatsAppNumber,
            i.FarmerId, i.Farmer?.Name, i.Farmer?.WhatsAppNumber,
            i.DriverId, i.Driver?.Name, i.Driver?.WhatsAppNumber,
            i.Status,
            i.TotalWeightKg, i.TotalValue, i.TransportFee, woodTotal,
            totalBoxes, i.BoxPriceApplied, boxFeeTotal,
            i.DriverBoxFeeApplied, driverBoxFeeTotal,
            grandTotal,
            previousBalance,
            i.CommissionRateApplied, commissionResult.Commission, netDueToFarmer,
            returnsTotal,
            paidAmount, grandTotal - paidAmount, paymentStatus,
            i.Items.Any(it => it.PricePerUnit == 0),
            i.Items.Select(it => new InvoiceItemDto(it.Id, it.ItemName, it.Quantity, it.Unit, it.PricePerUnit, it.WoodPrice, it.LineTotal)).ToList(),
            i.Returns.OrderBy(r => r.Date).Select(r => new GoodsReturnDto(
                r.Id, r.InvoiceId, i.InvoiceNumber, r.Date, r.Reason, r.TotalValue, r.CommissionRateApplied,
                r.Items.Select(ri => new GoodsReturnItemDto(ri.ItemName, ri.Quantity, ri.Unit, ri.PricePerUnit, ri.LineTotal)).ToList())).ToList());
    }
}
