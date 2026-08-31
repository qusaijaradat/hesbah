using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>Market operating expenses — part of the §13 main tables list; feeds net-profit reporting.</summary>
public class Expense : AuditableEntity
{
    public DateTimeOffset Date { get; set; }
    public string Description { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string? Category { get; set; }
    public int RecordedByUserId { get; set; }

    /// <summary>Optional link to the employee this expense/withdrawal was given to (see Employee.cs).</summary>
    public int? EmployeeId { get; set; }
    public Employee? Employee { get; set; }
}
