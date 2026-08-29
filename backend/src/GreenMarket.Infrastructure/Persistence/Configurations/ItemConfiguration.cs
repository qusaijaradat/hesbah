using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class ItemConfiguration : IEntityTypeConfiguration<Item>
{
    public void Configure(EntityTypeBuilder<Item> builder)
    {
        builder.ToTable("items");
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();

        // Case-insensitive "already exists?" lookup (ItemService.FindOrCreateAsync) plus the
        // name-suggestion list — a trigram GIN index for fuzzy matching is created in
        // database/schema.sql (same pattern as partners.name), not here.
        builder.HasIndex(x => x.Name);
    }
}
