using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class FarmerTransactionConfiguration : IEntityTypeConfiguration<FarmerTransaction>
{
    public void Configure(EntityTypeBuilder<FarmerTransaction> builder)
    {
        builder.ToTable("farmer_transactions");

        builder.Property(x => x.SaleValue).HasColumnType("numeric(14,2)");
        builder.Property(x => x.Commission).HasColumnType("numeric(14,2)");
        builder.Property(x => x.Amount).HasColumnType("numeric(14,2)");
        builder.Property(x => x.Notes).HasMaxLength(500);

        builder.HasOne(x => x.Farmer)
            .WithMany(p => p.FarmerTransactions)
            .HasForeignKey(x => x.FarmerId)
            .OnDelete(DeleteBehavior.Restrict);

        // One-to-MANY now (was one-to-one): an invoice can carry both a farmer's Sale row and a
        // driver's TransportFee row at once (see FarmerTransactionType.TransportFee /
        // Invoice.FarmerTransactions). A live database created before this change still has the
        // old UNIQUE index from the one-to-one mapping physically in place — see the Program.cs
        // startup guard that drops it (EnsureCreatedAsync only ever builds a fresh, empty database
        // from the CURRENT model; it never alters one that already exists).
        builder.HasOne(x => x.Invoice)
            .WithMany(i => i.FarmerTransactions)
            .HasForeignKey(x => x.InvoiceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.Payment)
            .WithMany()
            .HasForeignKey(x => x.PaymentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.FarmerId);
        builder.HasIndex(x => x.Date);
        builder.HasIndex(x => x.InvoiceId);
    }
}
