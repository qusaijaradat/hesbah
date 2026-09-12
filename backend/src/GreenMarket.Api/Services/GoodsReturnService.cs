using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// "مرتجع بضاعة" — goods a buyer sent back off one invoice. See the GoodsReturn entity for why
/// this exists as its own document rather than as an edit to the invoice.
/// </summary>
public interface IGoodsReturnService
{
    Task<IReadOnlyList<GoodsReturnDto>> ListForInvoiceAsync(int invoiceId);
    Task<GoodsReturnDto> CreateAsync(int invoiceId, CreateGoodsReturnRequest request, int recordedByUserId);
    Task DeleteAsync(int id);
}

public class GoodsReturnService : IGoodsReturnService
{
    private readonly AppDbContext _db;

    public GoodsReturnService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<GoodsReturnDto>> ListForInvoiceAsync(int invoiceId)
    {
        var returns = await _db.GoodsReturns
            .Where(r => r.InvoiceId == invoiceId)
            .Include(r => r.Items)
            .Include(r => r.Invoice)
            .OrderBy(r => r.Date).ThenBy(r => r.Id)
            .ToListAsync();

        return returns.Select(ToDto).ToList();
    }

    /// <summary>
    /// Records a return and moves both sides of the money in one transaction:
    ///
    ///  • The buyer's side is the invoice's stored <see cref="Invoice.GrandTotal"/>, recomputed
    ///    through <see cref="InvoiceCharge"/> with the new returns total subtracted — so every
    ///    balance, statement and report picks it up automatically, since they all read that one
    ///    column now.
    ///  • The seller's side is an offsetting Adjustment on their ledger for the returned value
    ///    MINUS the commission that was charged on it, using the rate locked in on the invoice.
    ///    Netting the commission out is the whole point: the market only earned commission on the
    ///    goods that actually sold, so a return has to give back the seller's share and drop the
    ///    market's own take by the rest.
    ///
    /// Guard rails: a line must actually appear on the invoice, and the quantity coming back can
    /// never exceed what was sold minus what has already been returned — otherwise a buyer could
    /// be credited twice for the same crate, quietly turning an invoice negative.
    /// </summary>
    public async Task<GoodsReturnDto> CreateAsync(int invoiceId, CreateGoodsReturnRequest request, int recordedByUserId)
    {
        if (request.Items is null || request.Items.Count == 0)
            throw new ValidationAppException("يجب تحديد صنف واحد على الأقل للمرتجع.");

        var invoice = await _db.Invoices
            .Include(i => i.Items)
            .Include(i => i.Returns).ThenInclude(r => r.Items)
            .SingleOrDefaultAsync(i => i.Id == invoiceId)
            ?? throw new NotFoundAppException("Invoice", invoiceId);

        if (invoice.Status != InvoiceStatus.Active)
            throw new ValidationAppException("لا يمكن تسجيل مرتجع على فاتورة ملغاة.");

        // How much of each item is still returnable: sold minus everything already back, counted
        // BOTH ways — العدد and الوزن — since a line now carries both and a return of a weighed line
        // has to be checked against its weight, not just its count. Matched on the same trimmed/
        // case-insensitive name key the rest of the app groups item names by; the key used to carry
        // the line's Kg/Box unit too, which a line no longer has.
        static string Key(string name) => name.Trim().ToLowerInvariant();

        var soldByKey = invoice.Items
            .GroupBy(it => Key(it.ItemName))
            .ToDictionary(g => g.Key, g => (
                Quantity: g.Sum(it => it.Quantity),
                Weight: g.Sum(it => it.WeightKg ?? 0m),
                Boxes: g.Sum(it => it.BoxQuantity),
                Cartons: g.Sum(it => it.CartonQuantity),
                Price: g.First().PricePerUnit,
                Display: g.First().ItemName.Trim()));

        var alreadyReturnedByKey = invoice.Returns
            .SelectMany(r => r.Items)
            .GroupBy(ri => Key(ri.ItemName))
            .ToDictionary(g => g.Key, g => (
                Quantity: g.Sum(ri => ri.Quantity),
                Weight: g.Sum(ri => ri.WeightKg ?? 0m),
                Boxes: g.Sum(ri => ri.BoxQuantity),
                Cartons: g.Sum(ri => ri.CartonQuantity)));

        var lines = new List<GoodsReturnItem>();
        foreach (var input in request.Items)
        {
            if (input.Quantity <= 0) continue; // a blank row on the form, not an error

            var key = Key(input.ItemName);
            if (!soldByKey.TryGetValue(key, out var sold))
                throw new ValidationAppException($"الصنف \"{input.ItemName}\" غير موجود على هذه الفاتورة.");

            // A return is priced from the invoice line as it stands right now, and that price is
            // then frozen into this document. An unpriced line (goods that went out before the
            // market priced them — a normal, supported flow, see InvoiceDto.HasUnpricedItems)
            // would freeze a return worth ZERO: pricing the item afterwards raises what the buyer
            // owes and what the seller is credited, while the return stays at nothing, so the
            // buyer ends up paying for goods he handed back. Refuse instead of recording a return
            // that is silently worth nothing — the item can be priced first, then returned.
            if (sold.Price <= 0)
                throw new ValidationAppException(
                    $"الصنف \"{sold.Display}\" لسه غير مسعّر على الفاتورة — سعّره أولًا، وبعدها سجّل المرتجع (وإلا رح ينحسب المرتجع بقيمة صفر).");

            var back = alreadyReturnedByKey.GetValueOrDefault(key);

            var remaining = sold.Quantity - back.Quantity;
            if (input.Quantity > remaining)
                throw new ValidationAppException(
                    $"الكمية المرتجعة من \"{sold.Display}\" ({input.Quantity:0.###}) أكبر من المتبقي القابل للإرجاع ({remaining:0.###}).");

            // The weight is checked on its own, because it is what a weighed line is priced by: a
            // return within the count but over the weight would credit back more money than the line
            // was ever worth.
            var remainingWeight = sold.Weight - back.Weight;
            if ((input.WeightKg ?? 0m) > remainingWeight)
                throw new ValidationAppException(
                    $"الوزن المرتجع من \"{sold.Display}\" ({input.WeightKg:0.###} كغم) أكبر من المتبقي القابل للإرجاع ({remainingWeight:0.###} كغم).");

            // Containers are their own physical count and cannot exceed what went out either.
            var remainingBoxes = sold.Boxes - back.Boxes;
            if (input.BoxQuantity > remainingBoxes)
                throw new ValidationAppException(
                    $"عدد الصناديق المرتجعة من \"{sold.Display}\" ({input.BoxQuantity:0.###}) أكبر من اللي طلع ({remainingBoxes:0.###}).");
            var remainingCartons = sold.Cartons - back.Cartons;
            if (input.CartonQuantity > remainingCartons)
                throw new ValidationAppException(
                    $"عدد الكرتون المرتجع من \"{sold.Display}\" ({input.CartonQuantity:0.###}) أكبر من اللي طلع ({remainingCartons:0.###}).");

            lines.Add(new GoodsReturnItem
            {
                ItemName = sold.Display,
                Quantity = input.Quantity,
                WeightKg = input.WeightKg,
                BoxQuantity = input.BoxQuantity,
                CartonQuantity = input.CartonQuantity,
                // Credited back at the price it was SOLD at, never a price the caller supplies.
                PricePerUnit = sold.Price,
                // Priced the same way the invoice line was — by weight when there is one.
                LineTotal = InvoiceCalculator.LineTotalFor(input.Quantity, input.WeightKg, sold.Price)
            });
        }

        if (lines.Count == 0)
            throw new ValidationAppException("يجب إدخال كمية أكبر من صفر لصنف واحد على الأقل.");

        var goodsReturn = new GoodsReturn
        {
            InvoiceId = invoice.Id,
            Date = request.Date,
            Reason = request.Reason,
            TotalValue = lines.Sum(l => l.LineTotal),
            CommissionRateApplied = invoice.CommissionRateApplied,
            RecordedByUserId = recordedByUserId,
            Items = lines
        };

        // The return row, the invoice's recomputed charge and the seller's offsetting ledger entry
        // all land together — a half-applied return would credit the buyer without debiting the
        // seller, or vice versa.
        await using var transaction = await _db.Database.BeginTransactionAsync();

        _db.GoodsReturns.Add(goodsReturn);
        await _db.SaveChangesAsync(); // need goodsReturn.Id for the ledger note below

        RecomputeGrandTotal(invoice, invoice.Returns.Sum(r => r.TotalValue) + goodsReturn.TotalValue);

        // Seller side. No farmer attached means there is no ledger to adjust — the buyer is still
        // credited, the market simply absorbs it.
        if (invoice.FarmerId is not null)
        {
            var commissionOnReturn = CommissionCalculator.Calculate(goodsReturn.TotalValue, invoice.CommissionRateApplied).Commission;
            _db.FarmerTransactions.Add(new FarmerTransaction
            {
                FarmerId = invoice.FarmerId.Value,
                Type = FarmerTransactionType.Adjustment,
                InvoiceId = invoice.Id,
                Date = goodsReturn.Date,
                Amount = -(goodsReturn.TotalValue - commissionOnReturn),
                Notes = $"مرتجع بضاعة على الفاتورة {invoice.InvoiceNumber}" +
                        (string.IsNullOrWhiteSpace(goodsReturn.Reason) ? "" : $" — {goodsReturn.Reason}")
            });
        }

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        goodsReturn.Invoice = invoice;
        return ToDto(goodsReturn);
    }

    /// <summary>
    /// Undoes a return that was recorded by mistake: the invoice's charge goes back up, and the
    /// seller's offsetting Adjustment is removed so their ledger returns to what it was. A hard
    /// delete rather than a soft one — an erroneous return is a data-entry slip, not a business
    /// event worth keeping (the audit log still records that it existed and was removed).
    /// </summary>
    public async Task DeleteAsync(int id)
    {
        var goodsReturn = await _db.GoodsReturns
            .Include(r => r.Items)
            .SingleOrDefaultAsync(r => r.Id == id)
            ?? throw new NotFoundAppException("GoodsReturn", id);

        var invoice = await _db.Invoices
            .Include(i => i.Items)
            .Include(i => i.Returns)
            .SingleAsync(i => i.Id == goodsReturn.InvoiceId);

        await using var transaction = await _db.Database.BeginTransactionAsync();

        // Matched on the note this service writes, and scoped to this invoice — the only
        // Adjustment rows carrying it are the ones raised for its returns.
        var ledgerNote = $"مرتجع بضاعة على الفاتورة {invoice.InvoiceNumber}";
        var adjustment = await _db.FarmerTransactions
            .Where(t => t.InvoiceId == invoice.Id
                && t.Type == FarmerTransactionType.Adjustment
                && t.Date == goodsReturn.Date
                && t.Notes != null && t.Notes.StartsWith(ledgerNote))
            .OrderByDescending(t => t.Id)
            .FirstOrDefaultAsync();
        if (adjustment is not null) _db.FarmerTransactions.Remove(adjustment);

        _db.GoodsReturns.Remove(goodsReturn);
        RecomputeGrandTotal(invoice, invoice.Returns.Where(r => r.Id != goodsReturn.Id).Sum(r => r.TotalValue));

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    /// <summary>
    /// Re-derives the invoice's stored charge from its own lines plus the given returns total. The
    /// wood and box figures are recomputed here the same way ToDto does, so this can never fall out
    /// of step with what the invoice displays.
    /// </summary>
    private static void RecomputeGrandTotal(Invoice invoice, decimal returnsTotal)
    {
        var woodTotal = invoice.Items.Sum(it => it.WoodPrice);
        var boxFeeTotal = invoice.Items.Sum(it => it.BoxQuantity) * invoice.BoxPriceApplied;
        invoice.GrandTotal = InvoiceCharge.ForMerchant(
            invoice.TotalValue, woodTotal, boxFeeTotal, returnsTotal);
    }

    private static GoodsReturnDto ToDto(GoodsReturn r) => new(
        r.Id, r.InvoiceId, r.Invoice?.InvoiceNumber ?? string.Empty, r.Date, r.Reason,
        r.TotalValue, r.CommissionRateApplied,
        r.Items.Select(i => new GoodsReturnItemDto(i.ItemName, i.Quantity, i.WeightKg, i.BoxQuantity, i.CartonQuantity, i.PricePerUnit, i.LineTotal)).ToList());
}
