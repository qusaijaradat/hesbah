using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class PartnerConfiguration : IEntityTypeConfiguration<Partner>
{
    public void Configure(EntityTypeBuilder<Partner> builder)
    {
        builder.ToTable("partners");
        builder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        builder.Property(x => x.WhatsAppNumber).HasMaxLength(30);
        builder.Property(x => x.Notes).HasMaxLength(1000);
        builder.Property(x => x.CreditLimit).HasColumnType("numeric(14,2)");

        // Trigram index for the §3 "suggest existing names while typing" feature is created in
        // database/schema.sql (requires the pg_trgm extension) rather than here, since EF Core's
        // HasMethod("gin") support for operator classes like gin_trgm_ops is limited pre-EF9.
        builder.HasIndex(x => x.Name);
        builder.HasIndex(x => x.Type);
    }
}
