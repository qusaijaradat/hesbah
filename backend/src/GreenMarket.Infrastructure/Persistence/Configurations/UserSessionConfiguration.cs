using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class UserSessionConfiguration : IEntityTypeConfiguration<UserSession>
{
    public void Configure(EntityTypeBuilder<UserSession> builder)
    {
        builder.ToTable("user_sessions");

        // SHA-256 as hex: always 64 characters, on both columns.
        builder.Property(x => x.TokenHash).IsRequired().HasMaxLength(64);
        builder.Property(x => x.PreviousTokenHash).HasMaxLength(64);
        builder.Property(x => x.RevokedReason).HasMaxLength(40);
        builder.Property(x => x.UserAgent).HasMaxLength(300);

        // Every refresh looks a session up by the hash it was handed, so this is the hot path.
        builder.HasIndex(x => x.TokenHash);
        // And by the retired hash, which is the theft check on that same path.
        builder.HasIndex(x => x.PreviousTokenHash);
        builder.HasIndex(x => x.UserId);

        // Deleting a user takes their sessions with them — there is nothing left to be signed in to.
        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
