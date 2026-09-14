using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class SackKindConfiguration : IEntityTypeConfiguration<SackKind>
{
    public void Configure(EntityTypeBuilder<SackKind> builder)
    {
        builder.ToTable("sack_kinds");
        builder.Property(x => x.Name).IsRequired().HasMaxLength(60);
        // Unique on the NAME, so "أحمر" typed twice on two different days is one kind and not two
        // half-balances. The soft-delete filter does not reach a unique index, which is what we
        // want here: a kind is deactivated, never deleted, and its name stays taken.
        builder.HasIndex(x => x.Name).IsUnique();
    }
}
