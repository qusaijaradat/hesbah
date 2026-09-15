using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// A person registering their own phone for notifications.
///
/// No [RequirePermission] anywhere here, deliberately and for the same reason AlertsController has
/// none: this is not a capability to hand out, it is somebody choosing to be told about what they
/// can already see. What they are told is decided entirely by their own permissions at send time
/// (see AlertPushSender), so a role that reaches nothing gets a working switch and a silent phone.
///
/// Every action is scoped to the caller's own user id, never to an id in the request — a device
/// belongs to whoever registered it.
/// </summary>
[ApiController]
[Authorize]
[Route("api/push")]
public class PushController : ControllerBase
{
    private readonly IPushService _push;
    private readonly ICurrentUserAccessor _currentUser;

    public PushController(IPushService push, ICurrentUserAccessor currentUser)
    {
        _push = push;
        _currentUser = currentUser;
    }

    /// <summary>Whether the server can send at all, the key a browser needs to subscribe, and how
    /// many devices this person already has registered.</summary>
    [HttpGet("status")]
    public async Task<ActionResult<PushStatusDto>> Status(CancellationToken ct) =>
        Ok(await _push.GetStatusAsync(
            UserId, User.FindAll(ClaimTypesExtra.Permission).Select(c => c.Value), ct));

    [HttpPost("subscribe")]
    public async Task<ActionResult> Subscribe([FromBody] PushSubscribeRequest request, CancellationToken ct)
    {
        await _push.SubscribeAsync(UserId, request, ct);
        return NoContent();
    }

    [HttpPost("unsubscribe")]
    public async Task<ActionResult> Unsubscribe([FromBody] PushUnsubscribeRequest request, CancellationToken ct)
    {
        await _push.UnsubscribeAsync(UserId, request.Endpoint, ct);
        return NoContent();
    }

    /// <summary>
    /// Sends one notification to this person's own devices, right now.
    ///
    /// Not a debugging leftover: the switch is worthless without it. Turning notifications on is a
    /// silent action whose result arrives at seven the next morning, and "nothing happened" is
    /// indistinguishable from a phone that quietly declined the permission, a subscription Apple
    /// dropped, or a VAPID key that does not match. One test buzz answers all of it at the moment
    /// somebody can still do something about it.
    /// </summary>
    [HttpPost("test")]
    public async Task<ActionResult<int>> Test(CancellationToken ct)
    {
        var sent = await _push.SendToUserAsync(UserId, new PushPayload(
            Title: "الحسبة",
            Body: "الإشعارات شغّالة ✅",
            Url: "/",
            Tag: "hesbah-test"), ct);
        return Ok(sent);
    }

    private int UserId => _currentUser.UserId ?? throw new UnauthorizedAccessException();
}
