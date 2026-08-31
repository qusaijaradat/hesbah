using GreenMarket.Domain.Common;

namespace GreenMarket.Domain.Entities;

/// <summary>
/// Internal staff member — deliberately separate from <see cref="Partner"/>/<c>PartnerType</c>,
/// which models external trade partners (sellers/drivers/merchants). Added so an entry on the
/// "مصاريف الحسبة" (Hasbeh Expenses) screen can optionally be attributed to a specific employee
/// via <see cref="Expense.EmployeeId"/>, which is what lets the Employees page tally how much
/// has been given to each one. A cash withdrawal/advance ("سحب") is represented the same way as
/// any other expense — just tagged with an employee and, by convention, Category = "سحب" — no
/// separate withdrawal mechanism was added since the existing free-text Category field already
/// covers it.
/// </summary>
public class Employee : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<Expense> Expenses { get; set; } = new List<Expense>();
}
