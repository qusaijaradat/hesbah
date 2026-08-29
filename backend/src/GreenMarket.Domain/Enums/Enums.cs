namespace GreenMarket.Domain.Enums;

/// <summary>
/// A person in the system. Requirement doc §3: a unified "Partners" table is used
/// for both farmers and merchants; a person can optionally be both at once.
/// </summary>
public enum PartnerType
{
    Farmer = 1,
    Merchant = 2,
    Both = 3
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

/// <summary>Kind of entry recorded against a farmer's internal ledger (requirement doc §5/§6).</summary>
public enum FarmerTransactionType
{
    /// <summary>Generated automatically when an invoice is issued: sale value, commission, net due.</summary>
    Sale = 1,

    /// <summary>A payment made to the farmer, reducing their remaining balance.</summary>
    Payment = 2,

    /// <summary>Manual adjustment (correction, write-off, etc.) — always logged to AuditLog.</summary>
    Adjustment = 3
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
    public const string InvoicesCancel = "invoices.cancel";
    public const string InvoicesView = "invoices.view";

    public const string PartnersManage = "partners.manage";
    public const string PartnersView = "partners.view";

    public const string PaymentsCreate = "payments.create";
    public const string PaymentsView = "payments.view";

    public const string ExpensesManage = "expenses.manage";

    public const string ReportsView = "reports.view";
    public const string ReportsExport = "reports.export";

    public const string SettingsManage = "settings.manage";
    public const string UsersManage = "users.manage";

    /// <summary>Viewing the full edit-history log (who changed what, and when) — kept separate
    /// from ReportsView since it can surface sensitive detail (e.g. old field values) that not
    /// every reports-viewing role should see.</summary>
    public const string AuditView = "audit.view";

    public static readonly string[] All =
    {
        InvoicesCreate, InvoicesEdit, InvoicesCancel, InvoicesView,
        PartnersManage, PartnersView,
        PaymentsCreate, PaymentsView,
        ExpensesManage,
        ReportsView, ReportsExport,
        SettingsManage, UsersManage,
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
