using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class PushSubscriptionConfiguration : IEntityTypeConfiguration<PushSubscription>
{
    public void Configure(EntityTypeBuilder<PushSubscription> builder)
    {
        builder.ToTable("push_subscriptions");

        // Push endpoints are long — Apple's run past 300 characters — and there is no upper bound
        // in the spec, so this is left unbounded rather than guessed at and truncated.
        builder.Property(x => x.Endpoint).IsRequired();
        builder.Property(x => x.P256dh).IsRequired().HasMaxLength(200);
        builder.Property(x => x.Auth).IsRequired().HasMaxLength(100);
        builder.Property(x => x.UserAgent).HasMaxLength(300);

        // The endpoint IS the subscription. A browser that re-registers hands back the same one,
        // so this is what makes re-registering an update instead of a second row shouting twice.
        builder.HasIndex(x => x.Endpoint).IsUnique();
        builder.HasIndex(x => x.UserId);

        // Deleting a user takes their devices with them — a notification addressed to an account
        // that no longer exists has nobody to be built for.
        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
