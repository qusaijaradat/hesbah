using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IExpenseService
{
    Task<ExpenseDto> CreateAsync(CreateExpenseRequest request, int recordedByUserId);
    Task<PagedResult<ExpenseDto>> ListAsync(DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize);
    Task<ExpenseDto> UpdateAsync(int id, UpdateExpenseRequest request);
    Task DeleteAsync(int id);
}

public class ExpenseService : IExpenseService
{
    private readonly AppDbContext _db;
    public ExpenseService(AppDbContext db) => _db = db;

    public async Task<ExpenseDto> CreateAsync(CreateExpenseRequest request, int recordedByUserId)
    {
        if (request.Amount < 0) throw new ValidationAppException("Expense amount cannot be negative.");

        var employee = await ResolveEmployeeAsync(request.EmployeeId);

        var expense = new Expense
        {
            Date = request.Date,
            Description = request.Description,
            Amount = request.Amount,
            Category = request.Category,
            RecordedByUserId = recordedByUserId,
            EmployeeId = employee?.Id,
            Employee = employee
        };
        _db.Expenses.Add(expense);
        await _db.SaveChangesAsync();
        return ToDto(expense);
    }

    public async Task<PagedResult<ExpenseDto>> ListAsync(DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize)
    {
        // ExpensesController's own print button calls this with pageSize=10000 (print everything
        // matching the current filter) — ceiling set above that instead of the usual 200, so that
        // legitimate request isn't silently truncated down to the default.
        (page, pageSize) = Paging.Clamp(page, pageSize, maxPageSize: 20_000);

        var query = _db.Expenses.Include(e => e.Employee).AsQueryable();
        if (from is not null) query = query.Where(e => e.Date >= from);
        if (to is not null) query = query.Where(e => e.Date <= to);

        var total = await query.CountAsync();
        var items = await query.OrderByDescending(e => e.Date)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(e => new ExpenseDto(e.Id, e.Date, e.Description, e.Amount, e.Category, e.EmployeeId, e.Employee != null ? e.Employee.Name : null))
            .ToListAsync();

        return new PagedResult<ExpenseDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task<ExpenseDto> UpdateAsync(int id, UpdateExpenseRequest request)
    {
        if (request.Amount < 0) throw new ValidationAppException("Expense amount cannot be negative.");
        // Previously required here but not on CreateAsync — an expense saved with no description
        // (perfectly possible on create) could then never be saved again on update, since every
        // subsequent save hit this same check. Relaxed to match CreateAsync's own behavior.

        var expense = await _db.Expenses.FindAsync(id) ?? throw new NotFoundAppException("Expense", id);
        var employee = await ResolveEmployeeAsync(request.EmployeeId);

        expense.Date = request.Date;
        expense.Description = request.Description;
        expense.Amount = request.Amount;
        expense.Category = request.Category;
        expense.EmployeeId = employee?.Id;
        expense.Employee = employee;
        await _db.SaveChangesAsync();
        return ToDto(expense);
    }

    public async Task DeleteAsync(int id)
    {
        var expense = await _db.Expenses.FindAsync(id) ?? throw new NotFoundAppException("Expense", id);
        expense.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    private async Task<Employee?> ResolveEmployeeAsync(int? employeeId)
    {
        if (employeeId is null) return null;
        return await _db.Employees.FindAsync(employeeId.Value) ?? throw new NotFoundAppException("Employee", employeeId.Value);
    }

    private static ExpenseDto ToDto(Expense e) => new(e.Id, e.Date, e.Description, e.Amount, e.Category, e.EmployeeId, e.Employee?.Name);
}
