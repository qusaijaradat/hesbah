using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// "المخالات" — sacks lent to buyers, counted per person AND per kind.
///
/// Sacks already lived in container_movements beside the crates, and they stay there: a second
/// table for the same idea is how two views of one thing end up disagreeing, and a person's sack
/// balance on their own page and on this screen have to be the same number. What this service adds
/// is the kind — a colour or a shape — and the ability to record several kinds as one event.
///
/// No money anywhere, on purpose, same as crates. Whatever the market charges for a lost sack is a
/// separate matter and must not touch the account balance, which is about produce.
/// </summary>
public interface ISackService
{
    Task<IReadOnlyList<SackKindDto>> ListKindsAsync(bool includeInactive);
    Task<SackKindDto> CreateKindAsync(CreateSackKindRequest request);
    Task<SackKindDto> UpdateKindAsync(int id, UpdateSackKindRequest request);

    /// <summary>Records one handover or one return — several kinds, one event. See the request type.</summary>
    Task<IReadOnlyList<SackMovementDto>> CreateMovementAsync(
        ContainerDirection direction, CreateSackMovementRequest request, int recordedByUserId);

    Task DeleteMovementAsync(int movementId);

    Task<SacksOverviewDto> GetOverviewAsync(DateTimeOffset? dateFrom, DateTimeOffset? dateTo, int? partnerId);
}

public class SackService : ISackService
{
    private readonly AppDbContext _db;

    public SackService(AppDbContext db) => _db = db;

    private const string NoKind = "بدون نوع";

    public async Task<IReadOnlyList<SackKindDto>> ListKindsAsync(bool includeInactive)
    {
        var query = _db.SackKinds.AsNoTracking();
        if (!includeInactive) query = query.Where(k => k.IsActive);
        return await query
            .OrderBy(k => k.Name)
            .Select(k => new SackKindDto(k.Id, k.Name, k.IsActive))
            .ToListAsync();
    }

    public async Task<SackKindDto> CreateKindAsync(CreateSackKindRequest request)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (name.Length == 0) throw new ValidationAppException("اسم النوع مطلوب.");

        // Case-insensitive, because "أحمر" and "احمر" typed on two different days are one colour,
        // and two of them would be two half-balances for the same sacks.
        var existing = await _db.SackKinds.FirstOrDefaultAsync(k => k.Name.ToLower() == name.ToLower());
        if (existing is not null)
        {
            // Re-adding a kind that was switched off is how someone turns it back on, and is a far
            // more likely intention than wanting a second one by the same name.
            if (!existing.IsActive)
            {
                existing.IsActive = true;
                await _db.SaveChangesAsync();
            }
            return new SackKindDto(existing.Id, existing.Name, existing.IsActive);
        }

        var kind = new SackKind { Name = name, IsActive = true };
        _db.SackKinds.Add(kind);
        await _db.SaveChangesAsync();
        return new SackKindDto(kind.Id, kind.Name, kind.IsActive);
    }

    public async Task<SackKindDto> UpdateKindAsync(int id, UpdateSackKindRequest request)
    {
        var kind = await _db.SackKinds.FindAsync(id) ?? throw new NotFoundAppException("Sack kind", id);
        var name = (request.Name ?? string.Empty).Trim();
        if (name.Length == 0) throw new ValidationAppException("اسم النوع مطلوب.");

        var clash = await _db.SackKinds.AnyAsync(k => k.Id != id && k.Name.ToLower() == name.ToLower());
        if (clash) throw new ConflictAppException("في نوع ثاني بنفس الاسم.");

        kind.Name = name;
        kind.IsActive = request.IsActive;
        await _db.SaveChangesAsync();
        return new SackKindDto(kind.Id, kind.Name, kind.IsActive);
    }

    public async Task<IReadOnlyList<SackMovementDto>> CreateMovementAsync(
        ContainerDirection direction, CreateSackMovementRequest request, int recordedByUserId)
    {
        var partner = await _db.Partners.FindAsync(request.PartnerId)
            ?? throw new NotFoundAppException("Partner", request.PartnerId);

        var lines = (request.Lines ?? Array.Empty<SackLineRequest>())
            .Where(l => l.Quantity != 0)
            .ToList();
        if (lines.Count == 0) throw new ValidationAppException("لازم تدخل نوع واحد على الأقل بعدد أكبر من صفر.");
        if (lines.Any(l => l.Quantity < 0))
            throw new ValidationAppException("العدد لازم يكون أكبر من صفر — الحركة الغلط بتنمسح، ما بتنسجّل بالسالب.");

        // Two lines of the same kind in one submission are one quantity. Left as two they would
        // both be right and the screen would show the kind twice, which reads as a mistake even
        // when the total is correct.
        var merged = lines
            .GroupBy(l => l.SackKindId)
            .Select(g => (KindId: g.Key, Quantity: g.Sum(l => l.Quantity)))
            .ToList();

        var kindIds = merged.Where(l => l.KindId is not null).Select(l => l.KindId!.Value).Distinct().ToList();
        var known = await _db.SackKinds.Where(k => kindIds.Contains(k.Id)).Select(k => k.Id).ToListAsync();
        var missing = kindIds.Except(known).ToList();
        if (missing.Count > 0) throw new NotFoundAppException("Sack kind", missing[0]);

        var created = new List<ContainerMovement>();
        foreach (var line in merged)
        {
            var movement = new ContainerMovement
            {
                PartnerId = partner.Id,
                Type = ContainerType.Sack,
                SackKindId = line.KindId,
                Direction = direction,
                Date = request.Date,
                Quantity = line.Quantity,
                Notes = request.Notes,
            };
            _db.ContainerMovements.Add(movement);
            created.Add(movement);
        }

        // One SaveChanges for the whole event: thirty red and twenty yellow handed over together
        // are one handover, and half of one recorded is a person holding sacks nobody wrote down.
        await _db.SaveChangesAsync();

        var names = await _db.SackKinds.Where(k => kindIds.Contains(k.Id))
            .ToDictionaryAsync(k => k.Id, k => k.Name);

        return created.Select(m => new SackMovementDto(
            m.Id, partner.Id, partner.Name, m.SackKindId,
            m.SackKindId is null ? NoKind : names.GetValueOrDefault(m.SackKindId.Value, NoKind),
            m.Direction.ToString(), m.Date, m.Quantity, m.Notes)).ToList();
    }

    public async Task DeleteMovementAsync(int movementId)
    {
        var movement = await _db.ContainerMovements.FindAsync(movementId)
            ?? throw new NotFoundAppException("Container movement", movementId);
        if (movement.Type != ContainerType.Sack)
            throw new ValidationAppException("هاي الحركة مش مخالات — امسحها من شاشة الصناديق.");
        movement.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    public async Task<SacksOverviewDto> GetOverviewAsync(DateTimeOffset? dateFrom, DateTimeOffset? dateTo, int? partnerId)
    {
        var query = _db.ContainerMovements.AsNoTracking()
            .Where(m => m.Type == ContainerType.Sack);
        if (dateFrom is not null) query = query.Where(m => m.Date >= dateFrom);
        if (dateTo is not null) query = query.Where(m => m.Date <= dateTo);
        if (partnerId is not null) query = query.Where(m => m.PartnerId == partnerId);

        var rows = await query
            .OrderByDescending(m => m.Date).ThenByDescending(m => m.Id)
            .Select(m => new
            {
                m.Id,
                m.PartnerId,
                PartnerName = m.Partner.Name,
                PartnerWhatsApp = m.Partner.WhatsAppNumber,
                m.SackKindId,
                KindName = m.SackKind != null ? m.SackKind.Name : null,
                m.Direction,
                m.Date,
                m.Quantity,
                m.Notes,
            })
            .ToListAsync();

        // Kept beside the movements rather than on them: a movement does not need a phone number,
        // and putting one on every row would carry the same string a hundred times.
        var whatsAppByPartner = rows
            .GroupBy(r => r.PartnerId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.PartnerWhatsApp).FirstOrDefault(x => x != null));

        var movements = rows.Select(r => new SackMovementDto(
            r.Id, r.PartnerId, r.PartnerName, r.SackKindId, r.KindName ?? NoKind,
            r.Direction.ToString(), r.Date, r.Quantity, r.Notes)).ToList();

        // Out − In, per kind. Positive means that many of the market's sacks are in other people's
        // hands; negative means the market is holding more of that kind than it lent, which is a
        // real state (somebody returned more than they took) and is left showing as a negative
        // rather than clamped, because clamping it would hide the mistake that caused it.
        var totals = movements
            .GroupBy(m => (m.SackKindId, m.SackKindName))
            .Select(g =>
            {
                var outQty = g.Where(x => x.Direction == nameof(ContainerDirection.Out)).Sum(x => x.Quantity);
                var inQty = g.Where(x => x.Direction == nameof(ContainerDirection.In)).Sum(x => x.Quantity);
                return new SackKindTotalDto(g.Key.SackKindId, g.Key.SackKindName, outQty, inQty, outQty - inQty);
            })
            .OrderBy(t => t.SackKindName, StringComparer.CurrentCulture)
            .ToList();

        var byPartner = movements
            .GroupBy(m => (m.PartnerId, m.PartnerName, m.SackKindId, m.SackKindName))
            .Select(g =>
            {
                var outQty = g.Where(x => x.Direction == nameof(ContainerDirection.Out)).Sum(x => x.Quantity);
                var inQty = g.Where(x => x.Direction == nameof(ContainerDirection.In)).Sum(x => x.Quantity);
                return new SackPartnerKindDto(
                    g.Key.PartnerId, g.Key.PartnerName, whatsAppByPartner.GetValueOrDefault(g.Key.PartnerId),
                    g.Key.SackKindId, g.Key.SackKindName,
                    outQty, inQty, outQty - inQty);
            })
            // Whoever is holding the most comes first — that is who the question is usually about.
            // Square rows are kept rather than dropped: on a screen with a date filter, "took ten,
            // brought ten back" is exactly what somebody is looking for.
            .OrderByDescending(p => p.Outstanding)
            .ThenBy(p => p.PartnerName, StringComparer.CurrentCulture)
            .ToList();

        return new SacksOverviewDto(dateFrom, dateTo, totals, byPartner, movements);
    }
}
