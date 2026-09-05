namespace GreenMarket.Domain.Enums;

/// <summary>
/// A person in the system. Requirement doc §3: a unified "Partners" table is used
/// for both farmers and merchants; a person can optionally be both at once.
/// </summary>
/// <remarks>
/// The UI no longer shows "Farmer" — it displays this value as "بائع" (Seller). <see cref="Driver"/>
/// ("سائق") is its OWN separate invoice slot (Invoice.DriverId, independent of Invoice.FarmerId) —
/// an invoice can have either, both, or neither attached. A driver's compensation (TransportFee)
/// still posts to the same "farmer_transactions" ledger table as a farmer's Sale does (see
/// FarmerTransactionType.TransportFee), so "كشف حساب بائع/سائق" (GetFarmerAccountAsync) and its
/// FarmerId-keyed statement/remaining-balance math work unchanged for either kind of person.
/// </remarks>
public enum PartnerType
{
    Farmer = 1,
    Merchant = 2,
    Both = 3,
    Driver = 4
}

/// <summary>
/// The unit an invoice line's quantity is measured in — not everything at the market is
/// sold by weight (e.g. a "box"/crate of produce), so this is per line, not per invoice.
/// </summary>
public enum UnitOfMeasure
{
    Kg = 1,
    Box = 2
}

/// <summary>Lifecycle state of an invoice. Requirement doc §2 calls out cancel/delete as a permission.</summary>
public enum InvoiceStatus
{
    Active = 1,
    Cancelled = 2
}

/// <summary>Which side of a transaction a payment settles.</summary>
public enum PaymentDirection
{
    /// <summary>Money coming IN from a merchant, against their purchases.</summary>
    FromMerchant = 1,

    /// <summary>Money going OUT to a farmer, against their net dues.</summary>
    ToFarmer = 2
}

/// <summary>
/// Lifecycle of a check ("شيك") payment — only meaningful when Payment.CheckDueDate is set (that
/// field, not the free-text Method string, is what marks a payment as a check). A brand-new check
/// payment always starts Pending; someone later flips it to Cleared once it's actually been cashed,
/// or Bounced if it came back — see PaymentService.UpdateAsync.
/// </summary>
public enum CheckClearanceStatus
{
    /// <summary>Received but not yet cashed/deposited — the common starting state.</summary>
    Pending = 1,

    /// <summary>Successfully cashed/deposited.</summary>
    Cleared = 2,

    /// <summary>Came back from the bank unpaid ("ارتد" / "مرتجع").</summary>
    Bounced = 3
}

/// <summary>
/// Kind of entry recorded against a farmer/driver's internal ledger (requirement doc §5/§6) — the
/// same "farmer_transactions" table now doubles as the driver's ledger too (see TransportFee),
/// since a driver's transport-fee balance works exactly the same way (owed → paid → remaining) and
/// posting payments TO a driver already went through this table via PaymentDirection.ToFarmer.
/// </summary>
public enum FarmerTransactionType
{
    /// <summary>Generated automatically when an invoice is issued: sale value, commission, net due.</summary>
    Sale = 1,

    /// <summary>A payment made to the farmer/driver, reducing their remaining balance.</summary>
    Payment = 2,

    /// <summary>Manual adjustment (correction, write-off, etc.) — always logged to AuditLog.</summary>
    Adjustment = 3,

    /// <summary>
    /// Generated automatically when an invoice with a driver AND a transport fee is issued —
    /// increases what the market owes that driver, exactly like a Sale row does for a farmer
    /// (SaleValue/Commission stay 0 on these rows; only Amount is used). FarmerId holds the
    /// DRIVER's partner id on these rows.
    /// </summary>
    TransportFee = 4
}

/// <summary>
/// Well-known permission keys, seeded into the Permissions table at first run.
/// Roles are a fully editable table (see <see cref="GreenMarket.Domain.Entities.Role"/>),
/// per requirement doc §13 ("Users, Roles, Permissions" are separate tables) — these
/// constants just give the seeder and the [RequirePermission] checks a single source
/// of truth instead of magic strings scattered around.
/// </summary>
public static class PermissionKeys
{
    public const string InvoicesCreate = "invoices.create";
    public const string InvoicesEdit = "invoices.edit";
    /// <summary>Invoices are never hard-deleted (requirement doc §2 calls the action "cancel"
    /// specifically) — this IS the "delete" permission for invoices, just named for what it does.</summary>
    public const string InvoicesCancel = "invoices.cancel";
    public const string InvoicesView = "invoices.view";

    public const string PartnersView = "partners.view";
    public const string PartnersCreate = "partners.create";
    public const string PartnersEdit = "partners.edit";
    /// <summary>Only ever succeeds on a partner with zero invoices/payments/ledger history —
    /// see PartnerService.DeleteAsync. For someone with real history, deactivating isn't even
    /// needed: they simply stop being picked for new invoices/payments once no longer used.</summary>
    public const string PartnersDelete = "partners.delete";

    /// <summary>The invoice item-name catalog (see Item.cs) — separate from Invoices* so a role
    /// can manage the item list without also being able to create/edit invoices, or vice versa.</summary>
    public const string ItemsView = "items.view";
    public const string ItemsCreate = "items.create";
    public const string ItemsEdit = "items.edit";
    public const string ItemsDelete = "items.delete";

    public const string PaymentsView = "payments.view";
    public const string PaymentsCreate = "payments.create";
    public const string PaymentsEdit = "payments.edit";
    public const string PaymentsDelete = "payments.delete";

    public const string ExpensesView = "expenses.view";
    public const string ExpensesCreate = "expenses.create";
    public const string ExpensesEdit = "expenses.edit";
    public const string ExpensesDelete = "expenses.delete";

    /// <summary>The Employees list (staff names) — viewing per-employee expense totals only
    /// needs EmployeesView; adding/renaming/deactivating staff needs Create/Edit; Delete only
    /// ever succeeds on an employee with zero expenses attributed — see EmployeeService.DeleteAsync.</summary>
    public const string EmployeesView = "employees.view";
    public const string EmployeesCreate = "employees.create";
    public const string EmployeesEdit = "employees.edit";
    public const string EmployeesDelete = "employees.delete";

    /// <summary>"بضاعة الباعة" goods-stock intake (see FarmerGoodsEntry) — separate from Invoices*
    /// so a role can log/correct what a farmer brought in without also being able to
    /// create/edit invoices, or vice versa. View also covers seeing the computed "available"
    /// stock and the existing sold-history breakdown on the same page.</summary>
    public const string FarmerGoodsView = "farmerGoods.view";
    public const string FarmerGoodsCreate = "farmerGoods.create";
    public const string FarmerGoodsEdit = "farmerGoods.edit";
    public const string FarmerGoodsDelete = "farmerGoods.delete";

    public const string ReportsView = "reports.view";
    public const string ReportsExport = "reports.export";

    public const string SettingsView = "settings.view";
    public const string SettingsEdit = "settings.edit";

    public const string UsersView = "users.view";
    public const string UsersCreate = "users.create";
    /// <summary>Also covers deactivating a user (User.IsActive) — there is deliberately no
    /// UsersDelete: a user account is never removed outright (its id is referenced from
    /// CreatedByUserId/RecordedByUserId all over the audit trail), only deactivated.</summary>
    public const string UsersEdit = "users.edit";

    /// <summary>Separate from Users* — a role can be handed out to whoever configures screen/action
    /// access without also letting them create or deactivate user accounts, or vice versa.</summary>
    public const string RolesView = "roles.view";
    public const string RolesCreate = "roles.create";
    public const string RolesEdit = "roles.edit";
    /// <summary>Only ever succeeds on a role with zero users currently assigned — see RoleService.DeleteAsync.</summary>
    public const string RolesDelete = "roles.delete";

    /// <summary>Viewing the full edit-history log (who changed what, and when) — kept separate
    /// from ReportsView since it can surface sensitive detail (e.g. old field values) that not
    /// every reports-viewing role should see.</summary>
    public const string AuditView = "audit.view";

    public static readonly string[] All =
    {
        InvoicesCreate, InvoicesEdit, InvoicesCancel, InvoicesView,
        PartnersView, PartnersCreate, PartnersEdit, PartnersDelete,
        ItemsView, ItemsCreate, ItemsEdit, ItemsDelete,
        PaymentsView, PaymentsCreate, PaymentsEdit, PaymentsDelete,
        ExpensesView, ExpensesCreate, ExpensesEdit, ExpensesDelete,
        EmployeesView, EmployeesCreate, EmployeesEdit, EmployeesDelete,
        FarmerGoodsView, FarmerGoodsCreate, FarmerGoodsEdit, FarmerGoodsDelete,
        ReportsView, ReportsExport,
        SettingsView, SettingsEdit,
        UsersView, UsersCreate, UsersEdit,
        RolesView, RolesCreate, RolesEdit, RolesDelete,
        AuditView
    };
}

/// <summary>Names of the roles seeded at first run (requirement doc §2 "suggested roles"). Admins may add more.</summary>
public static class SeedRoleNames
{
    public const string Admin = "Admin";
    public const string HasbehEmployee = "HasbehEmployee";
    public const string Accountant = "Accountant";
    public const string Viewer = "Viewer";
}
