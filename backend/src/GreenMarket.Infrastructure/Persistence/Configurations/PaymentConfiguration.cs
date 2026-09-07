using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class PaymentConfiguration : IEntityTypeConfiguration<Payment>
{
    public void Configure(EntityTypeBuilder<Payment> builder)
    {
        builder.ToTable("payments");
        builder.Property(x => x.Amount).HasColumnType("numeric(14,2)");
        builder.Property(x => x.Method).HasMaxLength(50);
        builder.Property(x => x.Notes).HasMaxLength(500);
        builder.Property(x => x.CheckNumber).HasMaxLength(50);

        builder.HasOne(x => x.Partner)
            .WithMany(p => p.Payments)
            .HasForeignKey(x => x.PartnerId)
            .OnDelete(DeleteBehavior.Restrict);

        // Optional link to the specific invoice this payment settles (roadmap: "link a payment
        // to a specific invoice"). The inverse is Invoice.Payments — named explicitly, because
        // an unnamed .WithMany() here plus a collection on the other side makes EF believe
        // there are TWO relationships over the same field and quietly map the second to a
        // shadow "InvoiceId1" column that does not exist in the database.
        builder.HasOne(x => x.Invoice)
            .WithMany(i => i.Payments)
            .HasForeignKey(x => x.InvoiceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.PartnerId);
        builder.HasIndex(x => x.Date);
        builder.HasIndex(x => x.InvoiceId);
        // Used by ListChecksAsync (the "الشيكات" page) to find every check payment fast — that
        // query filters on CheckDueDate != null and orders by it, so this index serves both.
        builder.HasIndex(x => x.CheckDueDate);
    }
}

public class ExpenseConfiguration : IEntityTypeConfiguration<Expense>
{
    public void Configure(EntityTypeBuilder<Expense> builder)
    {
        builder.ToTable("expenses");
        builder.Property(x => x.Description).HasMaxLength(500).IsRequired();
        builder.Property(x => x.Amount).HasColumnType("numeric(14,2)");
        builder.Property(x => x.Category).HasMaxLength(100);
        builder.HasIndex(x => x.Date);

        // Optional attribution to an employee (the Employees feature) — no navigation collection
        // is exposed the other way except Employee.Expenses, mirroring Payment/Invoice above.
        builder.HasOne(x => x.Employee)
            .WithMany(e => e.Expenses)
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(x => x.EmployeeId);
    }
}
