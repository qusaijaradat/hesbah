using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.Property(x => x.FullName).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Username).HasMaxLength(100).IsRequired();
        builder.HasIndex(x => x.Username).IsUnique();
        builder.Property(x => x.PasswordHash).HasMaxLength(200).IsRequired();
        builder.Property(x => x.PasswordSalt).HasMaxLength(200).IsRequired();

        builder.HasOne(x => x.Role)
            .WithMany(r => r.Users)
            .HasForeignKey(x => x.RoleId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
