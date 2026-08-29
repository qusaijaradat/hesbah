using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GreenMarket.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/expenses")]
public class ExpensesController : ControllerBase
{
    private readonly IExpenseService _expenseService;
    public ExpensesController(IExpenseService expenseService) => _expenseService = expenseService;

    [HttpGet]
    [RequirePermission(PermissionKeys.ExpensesManage)]
    public async Task<ActionResult> List(DateTimeOffset? from, DateTimeOffset? to, int page = 1, int pageSize = 25) =>
        Ok(await _expenseService.ListAsync(from, to, page, pageSize));

    [HttpPost]
    [RequirePermission(PermissionKeys.ExpensesManage)]
    public async Task<ActionResult<ExpenseDto>> Create(CreateExpenseRequest request) =>
        Ok(await _expenseService.CreateAsync(request, CurrentUserId.Require(User)));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.ExpensesManage)]
    public async Task<ActionResult<ExpenseDto>> Update(int id, UpdateExpenseRequest request) =>
        Ok(await _expenseService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.ExpensesManage)]
    public async Task<IActionResult> Delete(int id)
    {
        await _expenseService.DeleteAsync(id);
        return NoContent();
    }
}
