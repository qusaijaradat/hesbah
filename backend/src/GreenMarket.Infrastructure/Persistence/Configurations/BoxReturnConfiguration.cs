using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class BoxReturnConfiguration : IEntityTypeConfiguration<BoxReturn>
{
    public void Configure(EntityTypeBuilder<BoxReturn> builder)
    {
        builder.ToTable("box_returns");
        builder.Property(x => x.Quantity).HasColumnType("numeric(14,3)");
        builder.Property(x => x.Notes).HasMaxLength(500);

        // One-way reference to Partner (the merchant) — no collection navigation added on Partner
        // itself, same convention already used for FarmerGoodsEntry.Farmer.
        builder.HasOne(x => x.Partner)
            .WithMany()
            .HasForeignKey(x => x.PartnerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.PartnerId);
        builder.HasIndex(x => x.Date);
    }
}
