using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>"صناديق مطلوبة من المشتري" (explicit request) — recording when a merchant returns
/// empty crates. See BoxReturn's own doc comment for why this is a separate table/ledger from
/// Payment entirely (a crate count, not money).</summary>
public interface IBoxReturnService
{
    Task<BoxReturnDto> CreateAsync(int partnerId, CreateBoxReturnRequest request, int recordedByUserId);
    Task<IReadOnlyList<BoxReturnDto>> ListAsync(int partnerId);
    Task DeleteAsync(int id);
}

public class BoxReturnService : IBoxReturnService
{
    private readonly AppDbContext _db;

    public BoxReturnService(AppDbContext db) => _db = db;

    public async Task<BoxReturnDto> CreateAsync(int partnerId, CreateBoxReturnRequest request, int recordedByUserId)
    {
        if (request.Quantity <= 0)
            throw new ValidationAppException("Returned box quantity must be greater than zero.");

        // "صناديق مطلوبة من المشتري" is merchant-side by definition (see the interface doc
        // comment) — the id passed in previously wasn't checked at all beyond existing, so a
        // farmer or driver id could be recorded here and silently show up as a merchant's crate
        // balance on the wrong person's account.
        var partner = await _db.Partners.FindAsync(partnerId) ?? throw new NotFoundAppException("Partner", partnerId);
        // Type itself is nullable (staff can record a person before knowing their role) — a
        // still-unset Type is passed through rather than rejected, same as every other type check
        // added across this pass (see PaymentService.PartnerTypeMatches's doc comment).
        if (partner.Type is not (null or PartnerType.Merchant or PartnerType.Both))
            throw new ValidationAppException($"الشخص المحدد ({partner.Name}) ليس مشتريًا — لا يمكن تسجيل صناديق مرتجعة له.");

        var boxReturn = new BoxReturn
        {
            PartnerId = partnerId,
            Date = request.Date,
            Quantity = request.Quantity,
            Notes = request.Notes,
            RecordedByUserId = recordedByUserId
        };
        _db.BoxReturns.Add(boxReturn);
        await _db.SaveChangesAsync();

        return ToDto(boxReturn);
    }

    public async Task<IReadOnlyList<BoxReturnDto>> ListAsync(int partnerId) =>
        await _db.BoxReturns
            .Where(b => b.PartnerId == partnerId)
            .OrderByDescending(b => b.Date)
            .Select(b => new BoxReturnDto(b.Id, b.PartnerId, b.Date, b.Quantity, b.Notes))
            .ToListAsync();

    /// <summary>A wrong entry is corrected by deleting it and recording a fresh one — there is no
    /// UpdateAsync, matching the simplicity of what this table actually needs to support.</summary>
    public async Task DeleteAsync(int id)
    {
        var boxReturn = await _db.BoxReturns.SingleOrDefaultAsync(b => b.Id == id)
            ?? throw new NotFoundAppException("BoxReturn", id);
        boxReturn.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    private static BoxReturnDto ToDto(BoxReturn b) => new(b.Id, b.PartnerId, b.Date, b.Quantity, b.Notes);
}
