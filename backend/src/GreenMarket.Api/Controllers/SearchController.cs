using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// The one search box, in the app bar.
///
/// No [RequirePermission], for the same reason AlertsController has none: it spans several areas,
/// and one blanket permission would either hide invoices from somebody allowed to see them or hand
/// them to somebody who is not. Each kind is gated inside the service on the caller's own claims,
/// and somebody whose role reaches none of it gets an empty list rather than a 403 — there is
/// nothing to refuse them, there is simply nothing to show.
/// </summary>
[ApiController]
[Authorize]
[Route("api/search")]
public class SearchController : ControllerBase
{
    private readonly ISearchService _search;
    public SearchController(ISearchService search) => _search = search;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<SearchHitDto>>> Get(string? q, CancellationToken ct)
    {
        var permissions = User.FindAll(ClaimTypesExtra.Permission).Select(c => c.Value).ToHashSet();
        return Ok(await _search.SearchAsync(q ?? string.Empty, permissions, ct));
    }
}
