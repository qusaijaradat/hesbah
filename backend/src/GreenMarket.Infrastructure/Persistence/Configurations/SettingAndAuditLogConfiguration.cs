using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class SettingConfiguration : IEntityTypeConfiguration<Setting>
{
    public void Configure(EntityTypeBuilder<Setting> builder)
    {
        builder.ToTable("settings");
        builder.HasKey(x => x.Key);
        builder.Property(x => x.Key).HasMaxLength(100);
        builder.Property(x => x.Value).HasMaxLength(500).IsRequired();
        builder.Property(x => x.Description).HasMaxLength(500);
    }
}

public class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.ToTable("audit_logs");
        builder.Property(x => x.EntityName).HasMaxLength(100).IsRequired();
        builder.Property(x => x.EntityId).HasMaxLength(50).IsRequired();
        builder.Property(x => x.Action).HasMaxLength(50).IsRequired();
        builder.HasIndex(x => new { x.EntityName, x.EntityId });
        builder.HasIndex(x => x.At);
    }
}
