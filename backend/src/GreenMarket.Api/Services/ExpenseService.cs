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

        var expense = new Expense
        {
            Date = request.Date,
            Description = request.Description,
            Amount = request.Amount,
            Category = request.Category,
            RecordedByUserId = recordedByUserId
        };
        _db.Expenses.Add(expense);
        await _db.SaveChangesAsync();
        return ToDto(expense);
    }

    public async Task<PagedResult<ExpenseDto>> ListAsync(DateTimeOffset? from, DateTimeOffset? to, int page, int pageSize)
    {
        var query = _db.Expenses.AsQueryable();
        if (from is not null) query = query.Where(e => e.Date >= from);
        if (to is not null) query = query.Where(e => e.Date <= to);

        var total = await query.CountAsync();
        var items = await query.OrderByDescending(e => e.Date)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(e => ToDto(e))
            .ToListAsync();

        return new PagedResult<ExpenseDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize };
    }

    public async Task<ExpenseDto> UpdateAsync(int id, UpdateExpenseRequest request)
    {
        if (request.Amount < 0) throw new ValidationAppException("Expense amount cannot be negative.");
        if (string.IsNullOrWhiteSpace(request.Description)) throw new ValidationAppException("Description is required.");

        var expense = await _db.Expenses.FindAsync(id) ?? throw new NotFoundAppException("Expense", id);
        expense.Date = request.Date;
        expense.Description = request.Description;
        expense.Amount = request.Amount;
        expense.Category = request.Category;
        await _db.SaveChangesAsync();
        return ToDto(expense);
    }

    public async Task DeleteAsync(int id)
    {
        var expense = await _db.Expenses.FindAsync(id) ?? throw new NotFoundAppException("Expense", id);
        expense.IsDeleted = true;
        await _db.SaveChangesAsync();
    }

    private static ExpenseDto ToDto(Expense e) => new(e.Id, e.Date, e.Description, e.Amount, e.Category);
}
