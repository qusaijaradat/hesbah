using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class ContainerMovementConfiguration : IEntityTypeConfiguration<ContainerMovement>
{
    public void Configure(EntityTypeBuilder<ContainerMovement> builder)
    {
        // Renamed from "box_returns" — see the startup guard in Program.cs, which renames an
        // existing table in place rather than leaving the old rows behind in a dead one.
        builder.ToTable("container_movements");
        builder.Property(x => x.Quantity).HasColumnType("numeric(14,3)");
        builder.Property(x => x.Notes).HasMaxLength(500);

        // One-way reference to Partner — no collection navigation added on Partner itself, same
        // convention already used for FarmerGoodsEntry.Farmer.
        builder.HasOne(x => x.Partner)
            .WithMany()
            .HasForeignKey(x => x.PartnerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.PartnerId);
        builder.HasIndex(x => x.Date);
        // Every balance query filters by both at once.
        builder.HasIndex(x => new { x.PartnerId, x.Type });
    }
}
