using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// One box that finds anything.
///
/// This app has twenty screens, and until now the way to reach a thing was to know which screen
/// held it. "فاتورة ٤٥٦" meant remembering that invoices are filtered by number on the invoices
/// page; "أبو علي" meant remembering whether he is a buyer or a seller before choosing a page to
/// look on. That is a tax on everybody, every day, and it is paid most by whoever knows the app
/// least.
///
/// Deliberately shallow. It finds the RECORD and takes you to it — it is not a report and not a
/// second copy of any screen's filtering. Each kind is capped at a handful, because a box that
/// returns forty rows has answered a different question from the one that was asked.
///
/// Every kind is gated on the caller's own permission, the same way the alerts are: somebody who
/// may not open the invoices page must not be handed an invoice number and a total through a
/// search box either. A person with no matching permissions gets an empty list, never a 403 —
/// there is nothing to refuse, there is simply nothing they can be shown.
/// </summary>
public interface ISearchService
{
    Task<IReadOnlyList<SearchHitDto>> SearchAsync(
        string query, IReadOnlyCollection<string> permissions, CancellationToken ct = default);
}

public class SearchService : ISearchService
{
    private readonly AppDbContext _db;
    public SearchService(AppDbContext db) => _db = db;

    /// <summary>Per kind. Enough to recognise the one you meant, few enough to read at a glance.</summary>
    private const int PerKind = 6;

    public async Task<IReadOnlyList<SearchHitDto>> SearchAsync(
        string query, IReadOnlyCollection<string> permissions, CancellationToken ct = default)
    {
        var q = (query ?? string.Empty).Trim();
        // One character matches half the market. Two is the shortest thing worth asking about.
        if (q.Length < 2) return Array.Empty<SearchHitDto>();

        var hits = new List<SearchHitDto>();

        if (permissions.Contains(PermissionKeys.PartnersView))
        {
            var partners = await _db.Partners
                .Where(p => p.Name.Contains(q))
                // A name that STARTS with what was typed is almost always the one meant, so it
                // comes first — otherwise "علي" puts "أبو علي الثاني" above "علي".
                .OrderBy(p => p.Name.StartsWith(q) ? 0 : 1)
                .ThenBy(p => p.Name)
                .Take(PerKind)
                .Select(p => new { p.Id, p.Name, p.Type })
                .ToListAsync(ct);

            // A person who is BOTH a buyer and a seller gets two rows, because they have two
            // accounts: what they owe the market, and what the market owes them. Those are kept
            // entirely separate on every other screen (see PartnerLink), and a single row here
            // would have to pick one of them on the searcher's behalf — landing half of them on
            // the wrong page with no hint that the other one exists.
            foreach (var p in partners)
            {
                var label = PartnerRoles.Label(p.Type);
                var buyer = PartnerRoles.Has(p.Type, PartnerType.Merchant);
                var seller = PartnerRoles.HasSellerSide(p.Type);

                if (buyer)
                    hits.Add(new SearchHitDto(SearchHitKind.Partner, p.Id, p.Name,
                        $"{label} — حساب مشتري", $"/partners/{p.Id}/merchant-account"));
                if (seller)
                    hits.Add(new SearchHitDto(SearchHitKind.Partner, p.Id, p.Name,
                        $"{label} — حساب بائع/سائق", $"/partners/{p.Id}/farmer-account"));
                // No role recorded — somebody added from the sacks form, most likely. They have
                // no invoices either way; the buyer's page is where one would land first.
                if (!buyer && !seller)
                    hits.Add(new SearchHitDto(SearchHitKind.Partner, p.Id, p.Name,
                        "بدون دور", $"/partners/{p.Id}/merchant-account"));
            }
        }

        if (permissions.Contains(PermissionKeys.InvoicesView))
        {
            // By number, and by the buyer's name — the two things somebody actually remembers about
            // an invoice. Cancelled ones are findable too: "where did that invoice go" is precisely
            // a question about an invoice that is no longer in the ordinary list.
            var invoices = await _db.Invoices
                .Where(i => i.InvoiceNumber.Contains(q) || i.Merchant.Name.Contains(q))
                .OrderByDescending(i => i.Date)
                .Take(PerKind)
                .Select(i => new
                {
                    i.Id,
                    i.InvoiceNumber,
                    Merchant = i.Merchant.Name,
                    i.Date,
                    i.Status
                })
                .ToListAsync(ct);

            hits.AddRange(invoices.Select(i => new SearchHitDto(
                SearchHitKind.Invoice,
                i.Id,
                i.InvoiceNumber,
                // No money on the line. A search dropdown is read over somebody's shoulder far more
                // often than an account page is, and the name and the date identify it already.
                i.Status == InvoiceStatus.Cancelled
                    ? $"{i.Merchant} — ملغاة"
                    : i.Merchant,
                $"/invoices/{i.Id}")));
        }

        if (permissions.Contains(PermissionKeys.ItemsView))
        {
            var items = await _db.Items
                .Where(i => i.Name.Contains(q))
                .OrderBy(i => i.Name.StartsWith(q) ? 0 : 1)
                .ThenBy(i => i.Name)
                .Take(PerKind)
                .Select(i => new { i.Id, i.Name })
                .ToListAsync(ct);

            hits.AddRange(items.Select(i => new SearchHitDto(
                SearchHitKind.Item, i.Id, i.Name, "صنف", "/items")));
        }

        return hits;
    }

}
