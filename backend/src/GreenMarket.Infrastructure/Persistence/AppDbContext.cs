using GreenMarket.Domain.Common;
using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Infrastructure.Persistence;

public class AppDbContext : DbContext
{
    private readonly ICurrentUserAccessor? _currentUser;

    public AppDbContext(DbContextOptions<AppDbContext> options, ICurrentUserAccessor? currentUser = null)
        : base(options)
    {
        _currentUser = currentUser;
    }

    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Partner> Partners => Set<Partner>();
    public DbSet<Item> Items => Set<Item>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceItem> InvoiceItems => Set<InvoiceItem>();
    public DbSet<FarmerTransaction> FarmerTransactions => Set<FarmerTransaction>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<Expense> Expenses => Set<Expense>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<FarmerGoodsEntry> FarmerGoodsEntries => Set<FarmerGoodsEntry>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<CompanyLogo> CompanyLogos => Set<CompanyLogo>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        // Every AuditableEntity query defaults to excluding soft-deleted rows — callers that
        // genuinely need cancelled/deleted records (e.g. an "include cancelled" report toggle)
        // use .IgnoreQueryFilters() explicitly rather than every LINQ query remembering to filter.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (typeof(AuditableEntity).IsAssignableFrom(entityType.ClrType))
            {
                var method = typeof(AppDbContext)
                    .GetMethod(nameof(SetSoftDeleteFilter), System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!
                    .MakeGenericMethod(entityType.ClrType);
                method.Invoke(null, new object[] { modelBuilder });
            }
        }

        base.OnModelCreating(modelBuilder);
    }

    private static void SetSoftDeleteFilter<TEntity>(ModelBuilder modelBuilder) where TEntity : AuditableEntity
    {
        modelBuilder.Entity<TEntity>().HasQueryFilter(e => !e.IsDeleted);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyAuditStamps();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ApplyAuditStamps();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>
    /// Stamps CreatedAt/By and UpdatedAt/By automatically so no controller/service has to
    /// remember to do it (requirement doc §14: "who made it and when").  Fine-grained,
    /// field-level diffs for AuditLog are produced separately by AuditSaveChangesInterceptor,
    /// which needs access to ChangeTracker.Entries() *before* SaveChanges clears state — see
    /// that class for the full explanation of why it isn't done here.
    /// </summary>
    private void ApplyAuditStamps()
    {
        var now = DateTimeOffset.UtcNow;
        var userId = _currentUser?.UserId;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == Microsoft.EntityFrameworkCore.EntityState.Added)
            {
                entry.Entity.CreatedAt = now;
                entry.Entity.CreatedByUserId = userId;
            }
            else if (entry.State == Microsoft.EntityFrameworkCore.EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
                entry.Entity.UpdatedByUserId = userId;
            }
        }
    }
}

/// <summary>
/// Thin abstraction over "who is making this request", implemented in the Api layer from
/// the JWT claims (HttpContext) and injected here so the Infrastructure project has no
/// dependency on ASP.NET Core.
/// </summary>
public interface ICurrentUserAccessor
{
    int? UserId { get; }
}
