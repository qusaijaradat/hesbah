using GreenMarket.Api.Common;
using GreenMarket.Api.DTOs;
using GreenMarket.Domain.Entities;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

public interface IEmployeeService
{
    /// <summary><paramref name="activeOnly"/> is used by the "attribute this expense to an
    /// employee" picker so someone who left doesn't show up for new entries, while the
    /// Employees management page itself passes false to keep showing everyone (their historical
    /// total shouldn't disappear just because they're no longer active).</summary>
    Task<IReadOnlyList<EmployeeDto>> ListAsync(bool activeOnly = false);
    Task<EmployeeDto> GetAsync(int id);
    Task<EmployeeDto> CreateAsync(CreateEmployeeRequest request);
    Task<EmployeeDto> UpdateAsync(int id, UpdateEmployeeRequest request);

    /// <summary>Only ever succeeds on an employee with zero expenses/withdrawals ever attributed
    /// to them — see the implementation. An employee who left but has history should be deactivated
    /// (IsActive = false) instead, which already hides them from the "attribute this expense to"
    /// picker while keeping their historical total intact.</summary>
    Task DeleteAsync(int id);
}

/// <summary>
/// Internal staff (see Employee.cs) — a separate, much simpler CRUD than PartnerService since
/// there's no type/suggestion/account-statement machinery to mirror, just names plus a running
/// expense total per employee (the "نجسب كم نعطي المصاريف" tally the user asked for).
/// </summary>
public class EmployeeService : IEmployeeService
{
    private readonly AppDbContext _db;
    public EmployeeService(AppDbContext db) => _db = db;

    public async Task<IReadOnlyList<EmployeeDto>> ListAsync(bool activeOnly = false)
    {
        var query = _db.Employees.AsQueryable();
        if (activeOnly) query = query.Where(e => e.IsActive);

        return await query
            .OrderBy(e => e.Name)
            .Select(e => new EmployeeDto(
                e.Id, e.Name, e.Phone, e.Notes, e.IsActive,
                e.Expenses.Sum(x => (decimal?)x.Amount) ?? 0))
            .ToListAsync();
    }

    public async Task<EmployeeDto> GetAsync(int id)
    {
        var employee = await _db.Employees.FindAsync(id) ?? throw new NotFoundAppException("Employee", id);
        var total = await _db.Expenses.Where(x => x.EmployeeId == id).SumAsync(x => (decimal?)x.Amount) ?? 0;
        return new EmployeeDto(employee.Id, employee.Name, employee.Phone, employee.Notes, employee.IsActive, total);
    }

    public async Task<EmployeeDto> CreateAsync(CreateEmployeeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) throw new ValidationAppException("Employee name is required.");

        var employee = new Employee
        {
            Name = request.Name.Trim(),
            Phone = request.Phone,
            Notes = request.Notes,
            IsActive = true
        };
        _db.Employees.Add(employee);
        await _db.SaveChangesAsync();
        return new EmployeeDto(employee.Id, employee.Name, employee.Phone, employee.Notes, employee.IsActive, 0);
    }

    public async Task<EmployeeDto> UpdateAsync(int id, UpdateEmployeeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) throw new ValidationAppException("Employee name is required.");

        var employee = await _db.Employees.FindAsync(id) ?? throw new NotFoundAppException("Employee", id);
        employee.Name = request.Name.Trim();
        employee.Phone = request.Phone;
        employee.Notes = request.Notes;
        employee.IsActive = request.IsActive;
        await _db.SaveChangesAsync();
        return await GetAsync(id);
    }

    /// <summary>See the interface doc comment — a hard-ish removal (soft-delete via the inherited
    /// IsDeleted flag, globally filtered from then on) but only ever reachable on an employee with
    /// no expense history at all, so nothing downstream ever ends up pointing at a "gone" employee.</summary>
    public async Task DeleteAsync(int id)
    {
        var employee = await _db.Employees.FindAsync(id) ?? throw new NotFoundAppException("Employee", id);

        var hasExpenses = await _db.Expenses.AnyAsync(e => e.EmployeeId == id);
        if (hasExpenses)
            throw new ConflictAppException("لا يمكن حذف هذا الموظف لوجود مصاريف/سحوبات مسجّلة باسمه — يمكنك إلغاء تفعيله بدلاً من ذلك.");

        employee.IsDeleted = true;
        await _db.SaveChangesAsync();
    }
}
