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
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult> List([FromQuery] ItemFilterRequest filter) =>
        Ok(await _itemService.ListAsync(filter.Search, filter.Page, filter.PageSize));

    [HttpGet("suggest")]
    [RequirePermission(PermissionKeys.InvoicesView)]
    public async Task<ActionResult<IReadOnlyList<ItemDto>>> Suggest([FromQuery] string? q = null) =>
        Ok(await _itemService.SuggestAsync(q));

    [HttpPost]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    public async Task<ActionResult<ItemDto>> Create(CreateItemRequest request) => Ok(await _itemService.CreateAsync(request));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    public async Task<ActionResult<ItemDto>> Update(int id, UpdateItemRequest request) => Ok(await _itemService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.InvoicesCreate)]
    public async Task<IActionResult> Delete(int id)
    {
        await _itemService.DeleteAsync(id);
        return NoContent();
    }
}
