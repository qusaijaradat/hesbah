namespace GreenMarket.Api.DTOs;

public record CreateEmployeeRequest(string Name, string? Phone, string? Notes);

/// <summary>IsActive lets an employee who left be hidden from the "attribute this expense to"
/// picker (see EmployeesController.List's activeOnly) without losing their historical expense
/// records or their entry in the Employees management list.</summary>
public record UpdateEmployeeRequest(string Name, string? Phone, string? Notes, bool IsActive);

/// <summary>TotalExpenses is the running sum of every expense (including withdrawals — see
/// Employee.cs) ever attributed to this employee — the "كم نعطي المصاريف" tally the user asked for.</summary>
public record EmployeeDto(int Id, string Name, string? Phone, string? Notes, bool IsActive, decimal TotalExpenses);
