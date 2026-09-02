using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

/// <summary>
/// Growing produce/goods name catalog used by the invoice item picker (see ItemService).
/// Mirrors PartnersController: a searchable/paged list plus create/update/delete so the
/// catalog can be managed directly, not only grown incidentally from invoices.
/// </summary>
[ApiController]
[Authorize]
[Route("api/items")]
public class ItemsController : ControllerBase
{
    private readonly IItemService _itemService;
    public ItemsController(IItemService itemService) => _itemService = itemService;

    [HttpGet]
    [RequirePermission(PermissionKeys.ItemsView)]
    public async Task<ActionResult> List([FromQuery] ItemFilterRequest filter) =>
        Ok(await _itemService.ListAsync(filter.Search, filter.Page, filter.PageSize));

    // Suggestions feed the invoice item picker itself, so anyone who can create/edit an invoice
    // needs this even without a dedicated Items permission — checked against InvoicesView (the
    // narrowest permission every invoice-facing role already has) rather than ItemsView.
    [HttpGet("suggest")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<IReadOnlyList<ItemDto>>> Suggest([FromQuery] string? q = null) =>
        Ok(await _itemService.SuggestAsync(q));

    [HttpPost]
    [RequirePermission(PermissionKeys.ItemsCreate)]
    public async Task<ActionResult<ItemDto>> Create(CreateItemRequest request) => Ok(await _itemService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.ItemsEdit)]
    public async Task<ActionResult<ItemDto>> Update(int id, UpdateItemRequest request) => Ok(await _itemService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.ItemsDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _itemService.DeleteAsync(id);
        return NoContent();
    }
}
