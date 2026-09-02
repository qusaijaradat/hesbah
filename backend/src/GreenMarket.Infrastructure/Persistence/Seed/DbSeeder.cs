using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Infrastructure.Persistence.Seed;

/// <summary>
/// Idempotent first-run seeding: roles, permissions, role-permission grants, the
/// default admin account, and default settings (requirement doc §5's 7% commission
/// rate). Safe to call on every startup — every insert is guarded by an existence check.
/// Mirrors database/seed.sql; that file exists purely so the schema can be validated
/// without a .NET toolchain, this is the version the app actually runs.
/// </summary>
public static class DbSeeder
{
    public const string DefaultAdminUsername = "admin";
    public const string DefaultAdminPassword = "ChangeMe123!"; // force a change on first login in production

    public static async Task SeedAsync(AppDbContext db)
    {
        await SeedPermissionsAsync(db);
        await SeedRolesAsync(db);
        await SeedRolePermissionsAsync(db);
        await SeedAdminUserAsync(db);
        await SeedSettingsAsync(db);
    }

    private static async Task SeedPermissionsAsync(AppDbContext db)
    {
        var existing = await db.Permissions.Select(p => p.Key).ToListAsync();
        var missing = PermissionKeys.All.Except(existing);
        foreach (var key in missing)
        {
            db.Permissions.Add(new Permission { Key = key, Description = key });
        }
        await db.SaveChangesAsync();

        // A permission key retired from PermissionKeys.All (e.g. the old coarse "partners.manage"
        // split into partners.create/edit/delete) would otherwise sit forever as a dead row in the
        // Permissions table — still shown as an unlabeled checkbox on the Roles page and still
        // "granted" to whichever roles had it. Removing it here cascades to delete every
        // RolePermission row referencing it too (see RolePermissionConfiguration's cascade delete),
        // so a role's obsolete grants clean up automatically on the next startup — no manual
        // migration needed, matching this project's no-EF-migrations, idempotent-guard approach.
        var obsolete = await db.Permissions.Where(p => !PermissionKeys.All.Contains(p.Key)).ToListAsync();
        if (obsolete.Count > 0)
        {
            db.Permissions.RemoveRange(obsolete);
            await db.SaveChangesAsync();
        }
    }

    private static async Task SeedRolesAsync(AppDbContext db)
    {
        var roleNames = new[]
        {
            SeedRoleNames.Admin, SeedRoleNames.HasbehEmployee, SeedRoleNames.Accountant, SeedRoleNames.Viewer
        };
        var existing = await db.Roles.Select(r => r.Name).ToListAsync();
        foreach (var name in roleNames.Except(existing))
        {
            db.Roles.Add(new Role { Name = name, Description = DescriptionFor(name) });
        }
        await db.SaveChangesAsync();
    }

    private static string DescriptionFor(string roleName) => roleName switch
    {
        SeedRoleNames.Admin => "Full access to every screen and action, including user management.",
        SeedRoleNames.HasbehEmployee => "Day-to-day market operations: create invoices, manage partners, record payments.",
        SeedRoleNames.Accountant => "Financial views and reports; can record payments/expenses but not manage users.",
        SeedRoleNames.Viewer => "Read-only access to invoices, partners, and reports.",
        _ => string.Empty
    };

    private static async Task SeedRolePermissionsAsync(AppDbContext db)
    {
        var grants = new Dictionary<string, string[]>
        {
            [SeedRoleNames.Admin] = PermissionKeys.All,
            // Least-privilege defaults: non-Admin seeded roles get View/Create/Edit for the areas
            // they need day to day, but never Delete — an admin can grant that explicitly per role
            // via the "الأدوار والصلاحيات" page once they decide who should actually have it.
            [SeedRoleNames.HasbehEmployee] = new[]
            {
                PermissionKeys.InvoicesCreate, PermissionKeys.InvoicesEdit, PermissionKeys.InvoicesView,
                PermissionKeys.PartnersView, PermissionKeys.PartnersCreate, PermissionKeys.PartnersEdit,
                PermissionKeys.ItemsView, PermissionKeys.ItemsCreate, PermissionKeys.ItemsEdit,
                PermissionKeys.PaymentsView, PermissionKeys.PaymentsCreate, PermissionKeys.PaymentsEdit,
                PermissionKeys.ReportsView
            },
            [SeedRoleNames.Accountant] = new[]
            {
                PermissionKeys.InvoicesView, PermissionKeys.PartnersView,
                PermissionKeys.PaymentsView, PermissionKeys.PaymentsCreate, PermissionKeys.PaymentsEdit,
                PermissionKeys.ExpensesView, PermissionKeys.ExpensesCreate, PermissionKeys.ExpensesEdit,
                PermissionKeys.EmployeesView,
                PermissionKeys.ReportsView, PermissionKeys.ReportsExport
            },
            [SeedRoleNames.Viewer] = new[]
            {
                PermissionKeys.InvoicesView, PermissionKeys.PartnersView, PermissionKeys.PaymentsView,
                PermissionKeys.ItemsView, PermissionKeys.EmployeesView, PermissionKeys.ExpensesView,
                PermissionKeys.ReportsView
            },
        };

        var roles = await db.Roles.ToDictionaryAsync(r => r.Name);
        var permissions = await db.Permissions.ToDictionaryAsync(p => p.Key);
        // Note: can't Select(rp => (rp.RoleId, rp.PermissionId)) directly — a tuple literal
        // inside a lambda EF Core translates to an expression tree doesn't compile ("An
        // expression tree cannot contain a tuple literal"). Project to an anonymous type
        // (which IS translatable) and convert to tuples afterwards, in memory.
        var existingGrants = await db.RolePermissions
            .Select(rp => new { rp.RoleId, rp.PermissionId })
            .ToListAsync();
        var existingSet = existingGrants.Select(x => (x.RoleId, x.PermissionId)).ToHashSet();

        foreach (var (roleName, permissionKeys) in grants)
        {
            if (!roles.TryGetValue(roleName, out var role)) continue;

            foreach (var key in permissionKeys)
            {
                if (!permissions.TryGetValue(key, out var permission)) continue;
                if (existingSet.Contains((role.Id, permission.Id))) continue;

                db.RolePermissions.Add(new RolePermission { RoleId = role.Id, PermissionId = permission.Id });
            }
        }
        await db.SaveChangesAsync();
    }

    private static async Task SeedAdminUserAsync(AppDbContext db)
    {
        if (await db.Users.AnyAsync(u => u.Username == DefaultAdminUsername)) return;

        var adminRole = await db.Roles.SingleAsync(r => r.Name == SeedRoleNames.Admin);
        var (hash, salt) = PasswordHasher.HashPassword(DefaultAdminPassword);

        db.Users.Add(new User
        {
            FullName = "System Administrator",
            Username = DefaultAdminUsername,
            PasswordHash = hash,
            PasswordSalt = salt,
            RoleId = adminRole.Id,
            IsActive = true,
            // The whole point of seeding a known default password is that it's known — force
            // it to be replaced at first login instead of relying on whoever sets this up to
            // remember to change it themselves.
            MustChangePassword = true
        });
        await db.SaveChangesAsync();
    }

    private static async Task SeedSettingsAsync(AppDbContext db)
    {
        var defaults = new[]
        {
            new Setting { Key = Setting.Keys.DefaultCommissionRate, Value = "0.07", Description = "Default market commission rate applied to new invoices (requirement doc §5)." },
            new Setting { Key = Setting.Keys.MarketName, Value = "Green Market", Description = "Displayed on invoices and reports." },
            new Setting { Key = Setting.Keys.WhatsAppBusinessNumber, Value = "", Description = "WhatsApp Business number used to send invoices (requirement doc §9)." },
            new Setting { Key = Setting.Keys.RegistrationNumber, Value = "", Description = "Company/commercial registration number shown on the printed invoice header." },
            new Setting { Key = Setting.Keys.Phone, Value = "", Description = "Company phone number shown on the printed invoice header." },
            new Setting { Key = Setting.Keys.Address, Value = "", Description = "Company address shown on the printed invoice header." },
        };

        var existing = await db.Settings.Select(s => s.Key).ToListAsync();
        foreach (var setting in defaults.Where(s => !existing.Contains(s.Key)))
        {
            setting.UpdatedAt = DateTimeOffset.UtcNow;
            db.Settings.Add(setting);
        }
        await db.SaveChangesAsync();
    }
}
