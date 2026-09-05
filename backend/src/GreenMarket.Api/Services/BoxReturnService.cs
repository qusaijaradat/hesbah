using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
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

        _ = await _db.Partners.FindAsync(partnerId) ?? throw new NotFoundAppException("Partner", partnerId);

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
