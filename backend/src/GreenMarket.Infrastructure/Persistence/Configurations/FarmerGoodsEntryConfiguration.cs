using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class FarmerGoodsEntryConfiguration : IEntityTypeConfiguration<FarmerGoodsEntry>
{
    public void Configure(EntityTypeBuilder<FarmerGoodsEntry> builder)
    {
        builder.ToTable("farmer_goods_entries");
        builder.Property(x => x.ItemName).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Unit).HasConversion<int>();
        builder.Property(x => x.Quantity).HasColumnType("numeric(14,3)");
        builder.Property(x => x.WoodQuantity).HasColumnType("numeric(14,3)");
        builder.Property(x => x.Notes).HasMaxLength(500);

        // One-way reference to Partner (the farmer) — no collection navigation added on Partner
        // itself, same convention already used for Payment.Invoice/Expense.Employee.
        builder.HasOne(x => x.Farmer)
            .WithMany()
            .HasForeignKey(x => x.FarmerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.FarmerId);
        builder.HasIndex(x => x.Date);
        builder.HasIndex(x => x.ItemName);
    }
}
