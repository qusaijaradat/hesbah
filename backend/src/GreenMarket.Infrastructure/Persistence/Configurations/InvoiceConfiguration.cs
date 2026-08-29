using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class InvoiceConfiguration : IEntityTypeConfiguration<Invoice>
{
    public void Configure(EntityTypeBuilder<Invoice> builder)
    {
        builder.ToTable("invoices");
        builder.Property(x => x.InvoiceNumber).HasMaxLength(50).IsRequired();
        builder.HasIndex(x => x.InvoiceNumber).IsUnique();

        builder.Property(x => x.TotalWeightKg).HasColumnType("numeric(14,3)");
        builder.Property(x => x.TotalValue).HasColumnType("numeric(14,2)");
        builder.Property(x => x.CommissionRateApplied).HasColumnType("numeric(6,4)");
        builder.Property(x => x.CancellationReason).HasMaxLength(500);

        builder.HasOne(x => x.Merchant)
            .WithMany(p => p.Invoices)
            .HasForeignKey(x => x.MerchantId)
            .OnDelete(DeleteBehavior.Restrict);

        // A second FK from Invoice to Partner (as Farmer) — EF needs an explicit
        // navigation on one side only to avoid an ambiguous shadow relationship.
        // Optional: FarmerId is nullable (an invoice can be for the trader alone).
        builder.HasOne(x => x.Farmer)
            .WithMany()
            .HasForeignKey(x => x.FarmerId)
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired(false);

        builder.HasIndex(x => x.Date);
        builder.HasIndex(x => x.MerchantId);
        builder.HasIndex(x => x.FarmerId);
        builder.HasIndex(x => x.Status);

        builder.HasMany(x => x.Items)
            .WithOne(i => i.Invoice)
            .HasForeignKey(i => i.InvoiceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class InvoiceItemConfiguration : IEntityTypeConfiguration<InvoiceItem>
{
    public void Configure(EntityTypeBuilder<InvoiceItem> builder)
    {
        builder.ToTable("invoice_items");
        builder.Property(x => x.ItemName).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Quantity).HasColumnType("numeric(14,3)");
        builder.Property(x => x.Unit).HasConversion<int>();
        builder.Property(x => x.PricePerUnit).HasColumnType("numeric(14,2)");
        builder.Property(x => x.LineTotal).HasColumnType("numeric(14,2)");
        builder.HasIndex(x => x.ItemName);
    }
}
