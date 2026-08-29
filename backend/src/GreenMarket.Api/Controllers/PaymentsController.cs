using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>Requirement doc §6: recording payments and linking them to accounts.</summary>
[ApiController]
[Authorize]
[Route("api/payments")]
public class PaymentsController : ControllerBase
{
    private readonly IPaymentService _paymentService;
    public PaymentsController(IPaymentService paymentService) => _paymentService = paymentService;

    [HttpGet]
    [RequirePermission(PermissionKeys.PaymentsView)]
    public async Task<ActionResult> List(int? partnerId, int page = 1, int pageSize = 25) =>
        Ok(await _paymentService.ListAsync(partnerId, page, pageSize));

    [HttpPost]
    [RequirePermission(PermissionKeys.PaymentsCreate)]
    public async Task<ActionResult<PaymentDto>> Create(CreatePaymentRequest request) =>
        Ok(await _paymentService.CreateAsync(request, CurrentUserId.Require(User)));

    // Same permission as Create — whoever is trusted to record a payment is trusted to fix a
    // mistake in one (wrong amount/date typed in), rather than a separate finer-grained key.
    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.PaymentsCreate)]
    public async Task<ActionResult<PaymentDto>> Update(int id, UpdatePaymentRequest request) =>
        Ok(await _paymentService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.PaymentsCreate)]
    public async Task<IActionResult> Delete(int id)
    {
        await _paymentService.DeleteAsync(id);
        return NoContent();
    }
}
