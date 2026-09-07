using System.Globalization;
using System.IO.Compression;
using System.Text;
using GreenMarket.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GreenMarket.Api.Services;

/// <summary>
/// "نسخة احتياطية" — a one-click download of everything in the database as a ZIP of CSV files, one
/// per table.
///
/// Why this exists at all: the README lists automatic backups as an infrastructure concern, which
/// is true for a team with an ops person. A single market with no IT staff has no such person, and
/// "the server died and nobody had a copy" is the one failure that ends a business rather than
/// inconveniencing it. A button someone can press before going home closes that gap without
/// anyone learning what a cron job is.
///
/// Be clear about what this is and isn't. It is a complete DATA export — every row of every table,
/// ids and foreign keys included, so a technician can reload it — and it is readable by the owner
/// in Excel without any tooling. It is NOT a `pg_dump`: it carries no schema, no indexes, no
/// sequence positions. For real disaster recovery, a scheduled `pg_dump` at the infrastructure
/// level is still the right answer; this is the copy that exists in the meantime, which is worth
/// considerably more than the one that was going to be set up later.
///
/// Deliberately built on nothing new: System.IO.Compression ships with .NET and the CSV is written
/// here, so this adds no dependency and no binary that has to exist inside the container image.
/// </summary>
public interface IBackupService
{
    Task<byte[]> CreateCsvArchiveAsync(CancellationToken cancellationToken = default);
}

public class BackupService : IBackupService
{
    private readonly AppDbContext _db;

    public BackupService(AppDbContext db) => _db = db;

    public async Task<byte[]> CreateCsvArchiveAsync(CancellationToken cancellationToken = default)
    {
        using var buffer = new MemoryStream();
        // Left open so the archive is flushed by its own dispose below before the bytes are read.
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            // IgnoreQueryFilters throughout: a backup must include soft-deleted rows. They are what
            // makes a cancelled invoice or a removed payment reconstructable, and leaving them out
            // would quietly make the "complete" copy incomplete in exactly the cases someone would
            // go looking for it.
            await AddAsync(archive, "partners", _db.Partners.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "items", _db.Items, cancellationToken);
            await AddAsync(archive, "invoices", _db.Invoices.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "invoice_items", _db.InvoiceItems, cancellationToken);
            await AddAsync(archive, "goods_returns", _db.GoodsReturns.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "goods_return_items", _db.GoodsReturnItems, cancellationToken);
            await AddAsync(archive, "farmer_transactions", _db.FarmerTransactions, cancellationToken);
            await AddAsync(archive, "payments", _db.Payments.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "expenses", _db.Expenses.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "employees", _db.Employees.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "farmer_goods_entries", _db.FarmerGoodsEntries.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "box_returns", _db.BoxReturns.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "settings", _db.Settings, cancellationToken);
            await AddAsync(archive, "users", _db.Users.IgnoreQueryFilters(), cancellationToken);
            await AddAsync(archive, "roles", _db.Roles, cancellationToken);
            await AddAsync(archive, "permissions", _db.Permissions, cancellationToken);
            await AddAsync(archive, "role_permissions", _db.RolePermissions, cancellationToken);
            await AddAsync(archive, "audit_logs", _db.AuditLogs, cancellationToken);
        }
        return buffer.ToArray();
    }

    /// <summary>
    /// One table → one CSV entry. Columns come from the entity's own public scalar properties, so a
    /// field added to an entity later lands in the backup on its own rather than being silently
    /// dropped until someone remembers to update a hand-written column list.
    /// </summary>
    private static async Task AddAsync<T>(ZipArchive archive, string name, IQueryable<T> query, CancellationToken cancellationToken)
        where T : class
    {
        // Navigation properties and collections are skipped — every relationship is already carried
        // by its foreign-key column, and following them would serialize the whole graph repeatedly.
        var columns = typeof(T).GetProperties()
            .Where(p => p.CanRead && IsScalar(p.PropertyType))
            .ToList();

        var rows = await query.AsNoTracking().ToListAsync(cancellationToken);

        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", columns.Select(c => Escape(c.Name))));
        foreach (var row in rows)
            sb.AppendLine(string.Join(",", columns.Select(c => Escape(Format(c.GetValue(row))))));

        var entry = archive.CreateEntry($"{name}.csv", CompressionLevel.Optimal);
        await using var stream = entry.Open();
        // UTF-8 WITH a BOM on purpose: without it Excel on Windows opens the file as the system
        // codepage and every Arabic name in it comes out as mojibake, which is exactly the audience
        // this file is for.
        await using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        await writer.WriteAsync(sb.ToString());
    }

    private static bool IsScalar(Type type)
    {
        var t = Nullable.GetUnderlyingType(type) ?? type;
        return t.IsPrimitive || t.IsEnum
            || t == typeof(string) || t == typeof(decimal)
            || t == typeof(DateTime) || t == typeof(DateTimeOffset)
            || t == typeof(Guid) || t == typeof(TimeSpan);
    }

    /// <summary>Round-trippable, culture-independent text — a backup read back on a machine with a
    /// different locale must not reinterpret "3.5" as three and a half thousand.</summary>
    private static string Format(object? value) => value switch
    {
        null => string.Empty,
        DateTimeOffset dto => dto.ToString("o", CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString("o", CultureInfo.InvariantCulture),
        decimal d => d.ToString(CultureInfo.InvariantCulture),
        double d => d.ToString("R", CultureInfo.InvariantCulture),
        float f => f.ToString("R", CultureInfo.InvariantCulture),
        bool b => b ? "true" : "false",
        byte[] bytes => Convert.ToBase64String(bytes),
        _ => value.ToString() ?? string.Empty
    };

    /// <summary>Standard CSV quoting — a comma, quote or newline inside a name (an address, a
    /// cancellation reason) must not shift every column after it by one.</summary>
    private static string Escape(string value) =>
        value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r')
            ? $"\"{value.Replace("\"", "\"\"")}\""
            : value;
}
