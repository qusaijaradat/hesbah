using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// "الصناديق والمخالات" — empty containers the market lends out and expects back, counted per
/// person and per kind. Replaces the crate-returns-from-buyers-only service this grew out of; see
/// ContainerMovement for why one ledger rather than a second table beside the old one.
///
/// No money anywhere in here, deliberately. Whatever the market eventually charges for a crate is
/// a separate matter and has to stay separate from the person's account balance, which is about
/// produce — mixing them would make "المتبقي" mean two things at once.
/// </summary>
public interface IContainerService
{
    /// <summary>Every movement recorded for this person, newest first, both kinds.</summary>
    Task<IReadOnlyList<ContainerMovementDto>> ListAsync(int partnerId);

    /// <summary>One balance per kind for this person — see PartnerContainersDto.</summary>
    Task<PartnerContainersDto> GetForPartnerAsync(int partnerId);

    Task<ContainerMovementDto> CreateAsync(int partnerId, CreateContainerMovementRequest request, int recordedByUserId);

    Task DeleteAsync(int movementId);

    /// <summary>
    /// "مين ماسك صناديقي" — everyone who is not square, one line per person per kind. The money
    /// side has had this view for a while ("قيمة الدين"); without it, answering the same question
    /// about crates meant opening people one at a time and remembering.
    ///
    /// Aggregated in a handful of grouped queries rather than a round trip per partner, and using
    /// the same three components GetForPartnerAsync does, so a person's line here can never
    /// disagree with their own page.
    /// </summary>
    Task<IReadOnlyList<ContainerHolderDto>> GetHoldersAsync();
}

public class ContainerService : IContainerService
{
    private readonly AppDbContext _db;

    public ContainerService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<ContainerMovementDto>> ListAsync(int partnerId) =>
        await _db.ContainerMovements
            .Where(m => m.PartnerId == partnerId)
            .OrderByDescending(m => m.Date).ThenByDescending(m => m.Id)
            .Select(m => new ContainerMovementDto(m.Id, m.PartnerId, m.Type, m.Direction, m.Date, m.Quantity, m.Notes))
            .ToListAsync();

    public async Task<PartnerContainersDto> GetForPartnerAsync(int partnerId)
    {
        var partner = await _db.Partners.FindAsync(partnerId) ?? throw new NotFoundAppException("Partner", partnerId);
        var movements = await ListAsync(partnerId);

        // A crate physically leaves with every box-unit line a buyer takes, so that side is read
        // from their own invoices rather than re-typed — and netted against produce that came back
        // on a مرتجع, which arrives in its crates. Same figures PartnerService shows on the buyer's
        // account page; see its own comment for why. Sellers and drivers have no invoice-derived
        // side at all: everything they hold was handed over by hand and is recorded here.
        var invoiceBoxes = await InvoiceBoxesFor(partnerId);

        // The mirror image, on the seller's side: "صناديق خشب" counted on the "إضافة بضاعة" form
        // are real wooden crates that arrived with his produce, and they were being counted only
        // on that page — a third place tracking the same physical thing, which is how the crate
        // count, the stock and the money all came to disagree about a مرتجع. Read here rather
        // than re-typed, for the same reason the buyer's side is.
        var goodsEntryCrates = await GoodsEntryCratesFor(partnerId);

        var balances = new List<ContainerBalanceDto>();
        foreach (var type in new[] { ContainerType.Box, ContainerType.Sack })
        {
            // Both derived sides are crates; sacks are only ever recorded by hand.
            var fromInvoices = type == ContainerType.Box ? invoiceBoxes : 0m;
            var fromGoodsEntries = type == ContainerType.Box ? goodsEntryCrates : 0m;
            var handedOut = movements.Where(m => m.Type == type && m.Direction == ContainerDirection.Out).Sum(m => m.Quantity);
            var cameBack = movements.Where(m => m.Type == type && m.Direction == ContainerDirection.In).Sum(m => m.Quantity);
            balances.Add(new ContainerBalanceDto(
                type, fromInvoices, fromGoodsEntries, handedOut, cameBack,
                fromInvoices + handedOut - cameBack - fromGoodsEntries));
        }

        return new PartnerContainersDto(partner.Id, partner.Name, balances, movements);
    }

    public async Task<ContainerMovementDto> CreateAsync(int partnerId, CreateContainerMovementRequest request, int recordedByUserId)
    {
        if (request.Quantity <= 0)
            throw new ValidationAppException("العدد يجب أن يكون أكبر من صفر.");
        if (!Enum.IsDefined(request.Type))
            throw new ValidationAppException("نوع غير معروف.");
        if (!Enum.IsDefined(request.Direction))
            throw new ValidationAppException("اتجاه غير معروف.");

        // Anyone can hold containers — a buyer takes them away with produce, a seller or driver
        // takes them out to fill. So unlike the buyers-only service this replaces, there is no
        // partner-type check here at all.
        var partner = await _db.Partners.FindAsync(partnerId) ?? throw new NotFoundAppException("Partner", partnerId);

        var movement = new ContainerMovement
        {
            PartnerId = partner.Id,
            Type = request.Type,
            Direction = request.Direction,
            Date = request.Date,
            Quantity = request.Quantity,
            Notes = request.Notes,
            RecordedByUserId = recordedByUserId
        };
        _db.ContainerMovements.Add(movement);
        await _db.SaveChangesAsync();

        return new ContainerMovementDto(movement.Id, movement.PartnerId, movement.Type, movement.Direction, movement.Date, movement.Quantity, movement.Notes);
    }

    /// <summary>Soft-delete (AuditableEntity), so a movement entered by mistake stops counting
    /// while the row survives for the audit trail.</summary>
    public async Task DeleteAsync(int movementId)
    {
        var movement = await _db.ContainerMovements.SingleOrDefaultAsync(m => m.Id == movementId)
            ?? throw new NotFoundAppException("ContainerMovement", movementId);
        movement.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    public async Task<IReadOnlyList<ContainerHolderDto>> GetHoldersAsync()
    {
        // Out and In per (person, kind), from what was recorded by hand.
        var manual = await _db.ContainerMovements
            .GroupBy(m => new { m.PartnerId, m.Type, m.Direction })
            .Select(g => new { g.Key.PartnerId, g.Key.Type, g.Key.Direction, Total = g.Sum(m => m.Quantity) })
            .ToListAsync();

        // The two derived sides, same definitions as GetForPartnerAsync — crates only.
        var issued = await _db.Invoices
            .Where(i => i.Status == InvoiceStatus.Active)
            .SelectMany(i => i.Items.Where(it => it.Unit == UnitOfMeasure.Box).Select(it => new { i.MerchantId, it.Quantity }))
            .GroupBy(x => x.MerchantId)
            .Select(g => new { PartnerId = g.Key, Total = g.Sum(x => x.Quantity) })
            .ToListAsync();

        var backOnReturns = await _db.GoodsReturns
            .Where(r => r.Invoice.Status == InvoiceStatus.Active)
            .SelectMany(r => r.Items.Where(ri => ri.Unit == UnitOfMeasure.Box).Select(ri => new { r.Invoice.MerchantId, ri.Quantity }))
            .GroupBy(x => x.MerchantId)
            .Select(g => new { PartnerId = g.Key, Total = g.Sum(x => x.Quantity) })
            .ToListAsync();

        var goodsCrates = await _db.FarmerGoodsEntries
            .GroupBy(e => e.FarmerId)
            .Select(g => new { PartnerId = g.Key, Total = g.Sum(e => e.WoodQuantity) })
            .ToListAsync();

        var totals = new Dictionary<(int PartnerId, ContainerType Type), decimal>();
        void Add(int partnerId, ContainerType type, decimal amount)
        {
            if (amount == 0) return;
            var key = (partnerId, type);
            totals[key] = totals.GetValueOrDefault(key) + amount;
        }

        foreach (var row in manual)
            Add(row.PartnerId, row.Type, row.Direction == ContainerDirection.Out ? row.Total : -row.Total);
        foreach (var row in issued) Add(row.PartnerId, ContainerType.Box, row.Total);
        foreach (var row in backOnReturns) Add(row.PartnerId, ContainerType.Box, -row.Total);
        foreach (var row in goodsCrates) Add(row.PartnerId, ContainerType.Box, -row.Total);

        // Square is square — a person who has returned everything is finished business and only
        // pads the list, same treatment as a sold-out row on the stock screen.
        var open = totals.Where(kv => kv.Value != 0).ToList();
        if (open.Count == 0) return Array.Empty<ContainerHolderDto>();

        var ids = open.Select(kv => kv.Key.PartnerId).Distinct().ToList();
        var names = await _db.Partners.Where(p => ids.Contains(p.Id))
            .Select(p => new { p.Id, p.Name })
            .ToDictionaryAsync(x => x.Id, x => x.Name);

        return open
            // Whoever is holding the most of the market's comes first — that is who the question
            // is usually about.
            .OrderByDescending(kv => kv.Value)
            .Select(kv => new ContainerHolderDto(
                kv.Key.PartnerId, names.GetValueOrDefault(kv.Key.PartnerId) ?? "—", kv.Key.Type, kv.Value))
            .ToList();
    }

    /// <summary>
    /// Box-unit quantities on this partner's own active invoices AS A BUYER, net of what came back
    /// on a مرتجع. Zero for anyone who has never been the merchant on an invoice, which is what
    /// makes this safe to call for a seller or a driver.
    /// </summary>
    private async Task<decimal> InvoiceBoxesFor(int partnerId)
    {
        var issued = await _db.Invoices
            .Where(i => i.MerchantId == partnerId && i.Status == InvoiceStatus.Active)
            .SelectMany(i => i.Items)
            .Where(it => it.Unit == UnitOfMeasure.Box)
            .SumAsync(it => (decimal?)it.Quantity) ?? 0;

        var back = await _db.GoodsReturns
            .Where(r => r.Invoice.MerchantId == partnerId && r.Invoice.Status == InvoiceStatus.Active)
            .SelectMany(r => r.Items)
            .Where(ri => ri.Unit == UnitOfMeasure.Box)
            .SumAsync(ri => (decimal?)ri.Quantity) ?? 0;

        return issued - back;
    }

    /// <summary>
    /// Wooden crates logged against this partner's goods intake as a SELLER — the "صناديق خشب"
    /// field on "إضافة بضاعة" (FarmerGoodsEntry.WoodQuantity), which is a plain crate count and
    /// never a portion of the produce quantity. Zero for anyone who has never brought goods in,
    /// which is what makes this safe to call for a buyer or a driver.
    /// </summary>
    private async Task<decimal> GoodsEntryCratesFor(int partnerId) =>
        await _db.FarmerGoodsEntries
            .Where(e => e.FarmerId == partnerId)
            .SumAsync(e => (decimal?)e.WoodQuantity) ?? 0;
}
