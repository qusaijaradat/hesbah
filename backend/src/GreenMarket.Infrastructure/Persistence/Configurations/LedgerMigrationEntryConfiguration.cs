using GreenMarket.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GreenMarket.Infrastructure.Persistence.Configurations;

public class LedgerMigrationEntryConfiguration : IEntityTypeConfiguration<LedgerMigrationEntry>
{
    public void Configure(EntityTypeBuilder<LedgerMigrationEntry> builder)
    {
        builder.ToTable("ledger_migration_entries");

        builder.Property(x => x.Direction).IsRequired().HasMaxLength(20);
        builder.Property(x => x.Amount).HasPrecision(14, 2);

        // Undoing a run reads every row of that run and nothing else, so this is the only lookup
        // that matters — and the only one that has to stay fast once several runs are on record.
        builder.HasIndex(x => x.RunId);

        // No foreign key to farmer_transactions on purpose. A row this table points at can be
        // legitimately deleted afterwards (an invoice removed, a return undone), and a cascade
        // would then quietly erase the record that it was ever moved. The record of what a
        // migration did has to outlive the rows it touched.
    }
}
