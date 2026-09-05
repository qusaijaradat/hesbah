using GreenMarket.Api.Auth;
using GreenMarket.Api.DTOs;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
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
    private readonly IExportService _exportService;
    private readonly ISettingsService _settingsService;
    private readonly ICompanyLogoService _logoService;

    public ExpensesController(IExpenseService expenseService, IExportService exportService, ISettingsService settingsService, ICompanyLogoService logoService)
    {
        _expenseService = expenseService;
        _exportService = exportService;
        _settingsService = settingsService;
        _logoService = logoService;
    }

    [HttpGet]
    [RequirePermission(PermissionKeys.ExpensesView)]
    public async Task<ActionResult> List(DateTimeOffset? from, DateTimeOffset? to, int page = 1, int pageSize = 25) =>
        Ok(await _expenseService.ListAsync(from, to, page, pageSize));

    /// <summary>"مصاريف الحسبة" tab print button — see ExportService.GenerateExpensesListPdf's own
    /// doc comment. Same optional from/to date range as List above.</summary>
    [HttpGet("print/pdf")]
    [RequirePermission(PermissionKeys.ExpensesView)]
    public async Task<IActionResult> PrintPdf(DateTimeOffset? from, DateTimeOffset? to)
    {
        var result = await _expenseService.ListAsync(from, to, 1, 10000);
        var company = await GetCompanyInfoAsync();
        var bytes = _exportService.GenerateExpensesListPdf(result.Items, company, from, to);
        return File(bytes, "application/pdf", "expenses.pdf");
    }

    /// <summary>Same letterhead-building logic as the other controllers' own copies — kept
    /// duplicated rather than shared, matching how these controllers already don't share a base class.</summary>
    private async Task<CompanyInfo> GetCompanyInfoAsync()
    {
        var settings = await _settingsService.ListAsync();
        string? Get(string key)
        {
            var value = settings.FirstOrDefault(s => s.Key == key)?.Value;
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        var (logoContent, _) = await _logoService.GetEffectiveLogoAsync();

        return new CompanyInfo(
            Get(Setting.Keys.MarketName) ?? "Green Market",
            Get(Setting.Keys.Address),
            Get(Setting.Keys.Phone),
            Get(Setting.Keys.RegistrationNumber),
            logoContent);
    }

    [HttpPost]
    [RequirePermission(PermissionKeys.ExpensesCreate)]
    public async Task<ActionResult<ExpenseDto>> Create(CreateExpenseRequest request) =>
        Ok(await _expenseService.CreateAsync(request, CurrentUserId.Require(User)));

    [HttpPut("{id:int}")]
    [RequirePermission(PermissionKeys.ExpensesEdit)]
    public async Task<ActionResult<ExpenseDto>> Update(int id, UpdateExpenseRequest request) =>
        Ok(await _expenseService.UpdateAsync(id, request));

    [HttpDelete("{id:int}")]
    [RequirePermission(PermissionKeys.ExpensesDelete)]
    public async Task<IActionResult> Delete(int id)
    {
        await _expenseService.DeleteAsync(id);
        return NoContent();
    }
}
