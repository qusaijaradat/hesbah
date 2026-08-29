using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class RoleConfiguration : IEntityTypeConfiguration<Role>
{
    public void Configure(EntityTypeBuilder<Role> builder)
    {
        builder.ToTable("roles");
        builder.Property(x => x.Name).HasMaxLength(100).IsRequired();
        builder.HasIndex(x => x.Name).IsUnique();
        builder.Property(x => x.Description).HasMaxLength(500);
    }
}

public class PermissionConfiguration : IEntityTypeConfiguration<Permission>
{
    public void Configure(EntityTypeBuilder<Permission> builder)
    {
        builder.ToTable("permissions");
        builder.Property(x => x.Key).HasMaxLength(100).IsRequired();
        builder.HasIndex(x => x.Key).IsUnique();
        builder.Property(x => x.Description).HasMaxLength(500);
    }
}

public class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> builder)
    {
        builder.ToTable("role_permissions");
        builder.HasKey(x => new { x.RoleId, x.PermissionId });

        builder.HasOne(x => x.Role)
            .WithMany(r => r.RolePermissions)
            .HasForeignKey(x => x.RoleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.Permission)
            .WithMany(p => p.RolePermissions)
            .HasForeignKey(x => x.PermissionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
