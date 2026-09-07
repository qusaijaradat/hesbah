using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class GoodsReturnConfiguration : IEntityTypeConfiguration<GoodsReturn>
{
    public void Configure(EntityTypeBuilder<GoodsReturn> builder)
    {
        builder.ToTable("goods_returns");
        builder.Property(x => x.Reason).HasMaxLength(500);
        builder.Property(x => x.TotalValue).HasColumnType("numeric(14,2)");
        builder.Property(x => x.CommissionRateApplied).HasColumnType("numeric(6,4)");

        // Restrict, not Cascade: an invoice is never hard-deleted (it is soft-deleted — see
        // AuditableEntity.IsDeleted), so its returns must stay put alongside it rather than
        // silently disappearing if a row ever were removed for real.
        builder.HasOne(x => x.Invoice)
            .WithMany(i => i.Returns)
            .HasForeignKey(x => x.InvoiceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.InvoiceId);
        builder.HasIndex(x => x.Date);

        builder.HasMany(x => x.Items)
            .WithOne(i => i.GoodsReturn)
            .HasForeignKey(i => i.GoodsReturnId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class GoodsReturnItemConfiguration : IEntityTypeConfiguration<GoodsReturnItem>
{
    public void Configure(EntityTypeBuilder<GoodsReturnItem> builder)
    {
        builder.ToTable("goods_return_items");
        builder.Property(x => x.ItemName).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Quantity).HasColumnType("numeric(14,3)");
        builder.Property(x => x.Unit).HasConversion<int>();
        builder.Property(x => x.PricePerUnit).HasColumnType("numeric(14,2)");
        builder.Property(x => x.LineTotal).HasColumnType("numeric(14,2)");
    }
}
