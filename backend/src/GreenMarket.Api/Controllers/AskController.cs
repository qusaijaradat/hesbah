using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services.Ask;
using GreenMarket.Domain.Enums;
using GreenMarket.Domain.Services.Ask;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// "اسأل" — one question in Arabic, one answer from figures the app already computes.
///
/// Behind the same permission as the reports screens, and for the same reason: every question it
/// can answer is a report, so anyone who may ask here could already have read the answer by
/// navigating to it. It reads and nothing else — there is no intent that writes.
/// </summary>
[ApiController]
[Authorize]
[Route("api/ask")]
public class AskController : ControllerBase
{
    private readonly IAskService _ask;
    private readonly IAskPlanner _planner;

    public AskController(IAskService ask, IAskPlanner planner)
    {
        _ask = ask;
        _planner = planner;
    }

    /// <summary>
    /// The feature always works — questions are read from keywords, free and offline. This only
    /// reports whether a model is ALSO configured to take the ones those keywords cannot place, so
    /// the screen can say which of the two answered.
    /// </summary>
    [HttpGet("status")]
    [RequirePermission(PermissionKeys.ReportsView)]
    public ActionResult<object> Status() => Ok(new { configured = true, modelAssist = _planner.IsConfigured });

    [HttpPost]
    [RequirePermission(PermissionKeys.ReportsView)]
    public async Task<ActionResult<AskAnswerDto>> Ask(AskRequest request, CancellationToken cancellationToken) =>
        Ok(await _ask.AskAsync(request.Question, cancellationToken));
}

public record AskRequest(string Question);
