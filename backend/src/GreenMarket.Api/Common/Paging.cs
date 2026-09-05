namespace GreenMarket.Api.Common;

/// <summary>
/// Shared page/pageSize clamp. Previously only AuditLogService bounded pageSize (≤200) and
/// guarded against page &lt; 1 — every other paged list (expenses, partners, items, payments,
/// checks) accepted an unbounded pageSize straight into Skip/Take, so a very large requested
/// pageSize could load an unexpectedly huge result set into memory in one request, and page=0 or a
/// negative page produced a negative Skip that PostgreSQL rejects with an unhandled error instead
/// of a clear one. Every paged list now clamps the same way AuditLogService already did.
/// </summary>
public static class Paging
{
    public static (int Page, int PageSize) Clamp(int page, int pageSize, int maxPageSize = 200, int defaultPageSize = 25)
    {
        var clampedPage = page < 1 ? 1 : page;
        var clampedPageSize = pageSize is < 1 || pageSize > maxPageSize ? defaultPageSize : pageSize;
        return (clampedPage, clampedPageSize);
    }
}
