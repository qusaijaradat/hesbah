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
