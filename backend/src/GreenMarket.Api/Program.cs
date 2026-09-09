using System.Text;
using System.Text.Json.Serialization;
using GreenMarket.Api.Auth;
using GreenMarket.Api.Common;
using GreenMarket.Api.Services;
using GreenMarket.Domain.Entities;
using GreenMarket.Domain.Enums;
using GreenMarket.Infrastructure.Persistence;
using GreenMarket.Infrastructure.Persistence.Seed;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using QuestPDF.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// QuestPDF Community license — see GreenMarket.Api.csproj comment on the free-tier revenue cap.
QuestPDF.Settings.License = LicenseType.Community;

// ---------- Configuration ----------
builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection(JwtSettings.SectionName));

// ---------- Persistence ----------
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUserAccessor, CurrentUserAccessor>();
builder.Services.AddScoped<AuditSaveChangesInterceptor>();

builder.Services.AddDbContext<AppDbContext>((serviceProvider, options) =>
{
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"));
    options.AddInterceptors(serviceProvider.GetRequiredService<AuditSaveChangesInterceptor>());
});

// ---------- Application services ----------
builder.Services.AddScoped<IJwtTokenGenerator, JwtTokenGenerator>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IPartnerService, PartnerService>();
builder.Services.AddScoped<IItemService, ItemService>();
builder.Services.AddScoped<IInvoiceService, InvoiceService>();
builder.Services.AddScoped<IPaymentService, PaymentService>();
builder.Services.AddScoped<IContainerService, ContainerService>();
builder.Services.AddScoped<IGoodsReturnService, GoodsReturnService>();
builder.Services.AddScoped<IExpenseService, ExpenseService>();
builder.Services.AddScoped<IEmployeeService, EmployeeService>();
builder.Services.AddScoped<IGoodsService, GoodsService>();
builder.Services.AddScoped<IReportService, ReportService>();
builder.Services.AddScoped<ISettingsService, SettingsService>();
builder.Services.AddScoped<ICompanyLogoService, CompanyLogoService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<IBackupService, BackupService>();
builder.Services.AddScoped<IAlertService, AlertService>();
builder.Services.AddScoped<IRoleService, RoleService>();
builder.Services.AddSingleton<IExportService, ExportService>();

// ---------- Auth ----------
var jwtSection = builder.Configuration.GetSection(JwtSettings.SectionName);
var jwtSettings = jwtSection.Get<JwtSettings>() ?? throw new InvalidOperationException("Jwt configuration section is missing.");

// Fail fast outside Development rather than silently booting with a guessable signing key —
// appsettings.json ships a literal "CHANGE_ME_TO_..." placeholder specifically so a deployment
// that never replaced it gets caught here instead of issuing forgeable tokens in production.
if (!builder.Environment.IsDevelopment())
{
    if (string.IsNullOrWhiteSpace(jwtSettings.SigningKey) || jwtSettings.SigningKey.Length < 32)
        throw new InvalidOperationException("Jwt:SigningKey must be set to a real random secret of at least 32 characters before running outside Development.");
    if (jwtSettings.SigningKey.Contains("CHANGE_ME", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Jwt:SigningKey is still the placeholder value from appsettings.json — set a real random secret before running outside Development.");
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = jwtSettings.Issuer,
        ValidateAudience = true,
        ValidAudience = jwtSettings.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SigningKey)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30)
    };
});

// Requirement doc §2: "permissions are at the level of operations and screens" — one
// ASP.NET Core authorization policy per permission key, checked via [RequirePermission(...)].
builder.Services.AddAuthorization(options =>
{
    foreach (var key in PermissionKeys.All)
    {
        options.AddPolicy(key, policy => policy.Requirements.Add(new PermissionRequirement(key)));
    }
});
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();

// ---------- CORS (requirement doc §10: React frontend runs separately, on its own origin) ----------
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        // In Development, the frontend can be opened from any device on the local network
        // (e.g. a phone at http://<laptop-LAN-IP>:5173) to test responsiveness, and that IP
        // isn't known/fixed ahead of time — so allow any origin rather than hardcoding one.
        // Auth is a Bearer token in a header (not a cookie), so this carries no credential
        // risk. Production still uses the explicit, configured allow-list below.
        if (builder.Environment.IsDevelopment())
            policy.SetIsOriginAllowed(_ => true).AllowAnyHeader().AllowAnyMethod();
        else
            policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
    });
});

// ---------- MVC / Swagger ----------
// The frontend sends/expects enums as readable strings (e.g. "Farmer", not 1) —
// without this, System.Text.Json's default enum handling expects/returns the
// underlying numeric value and rejects string values like "Farmer" outright,
// which is what caused the "$.type could not be converted" error.
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "Green Market Management System API", Version = "v1" });

    var bearerScheme = new OpenApiSecurityScheme
    {
        Scheme = "bearer",
        BearerFormat = "JWT",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
    };
    options.AddSecurityDefinition("Bearer", bearerScheme);
    options.AddSecurityRequirement(new OpenApiSecurityRequirement { { bearerScheme, Array.Empty<string>() } });
});

var app = builder.Build();

// ---------- PDF fonts ----------
// Must run before any PDF is generated (invoice requests come well after this, so right after
// the app is built is early enough) — see PdfFontRegistration.cs for why "Tahoma" (used by every
// ExportService PDF) needs to be backed by a bundled font rather than the OS's own fonts.
// Wrapped defensively: this is new, unproven-in-production code, and the two most recent
// production deploys both failed their health check right after changes like this one landed —
// if bundling the font ever goes wrong for some reason (e.g. a future packaging change strips the
// embedded resource), the worst outcome should be "invoice PDFs render Arabic incorrectly again",
// logged clearly, never "the entire site is down".
try
{
    PdfFontRegistration.RegisterBundledFonts();
}
catch (Exception ex)
{
    app.Logger.LogError(ex, "Failed to register bundled PDF fonts (Amiri) — invoice PDFs may render Arabic text as garbled/missing glyphs until this is fixed.");
}

// ---------- First-run schema + seed ----------
// EnsureCreated (not Migrate) deliberately: this scaffold has no EF Core migrations yet
// because `dotnet ef migrations add` needs the same NuGet-restored `dotnet-ef` tool that
// this environment can't install (see docs/DEVELOPMENT_NOTES.md). EnsureCreated builds the
// schema straight from the C# model, which is fine until you need your first *versioned*
// schema change — at that point, on a machine with normal internet access, run:
//   dotnet ef migrations add InitialCreate --project src/GreenMarket.Infrastructure --startup-project src/GreenMarket.Api
//   dotnet ef database update            --project src/GreenMarket.Infrastructure --startup-project src/GreenMarket.Api
// and switch this call to db.Database.MigrateAsync() from then on.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();

    // EnsureCreated only builds the schema on a brand-new (tableless) database — on an
    // already-running installation (e.g. production, which already has "settings", "invoices",
    // etc.) it sees existing tables and does nothing at all, so a table added to the C# model
    // later (like CompanyLogo, added for the logo-upload feature) never actually gets created
    // there. Guard for that case explicitly instead of silently 500-ing the first time someone
    // uploads a logo. Safe to run every startup either way — CREATE TABLE IF NOT EXISTS is a no-op
    // once the table exists (including right after EnsureCreatedAsync made it on a fresh install).
    // Wrapped defensively for the same reason as the font registration above: if this ever fails
    // (e.g. the production DB role turns out not to have CREATE TABLE rights), the app should keep
    // serving everything else with the logo feature degraded, not go down entirely.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS company_logos (
                "Id" integer NOT NULL PRIMARY KEY,
                "Content" bytea NOT NULL,
                "ContentType" character varying(100) NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "UpdatedByUserId" integer NULL
            );
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to ensure the company_logos table exists — logo upload/display will not work until this is fixed.");
    }

    // Same EnsureCreated gap as company_logos above: columns added to the C# model (Invoice.DriverId/
    // TransportFee, InvoiceItem.WoodPrice — transport fee, wood/crate price, and a separate driver
    // slot) never get added to an already-existing "invoices"/"invoice_items" table. ADD COLUMN IF
    // NOT EXISTS is a no-op once the column exists, so safe to run every startup. No FK constraint is
    // added for DriverId here (unlike a normal EF migration would) to keep this a simple, safely
    // idempotent statement — the application layer already fully controls what gets written there,
    // matching the same tradeoff already accepted for company_logos.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "DriverId" integer NULL;
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "TransportFee" numeric(12,2) NOT NULL DEFAULT 0;
            ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS "WoodPrice" numeric(6,2) NOT NULL DEFAULT 0;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the DriverId/TransportFee/WoodPrice columns — the transport fee, wood price, and separate driver fields will not work until this is fixed.");
    }

    // Same EnsureCreated gap as above: the new "Employees" feature (مصاريف الحسبة → موظفين) needs
    // a brand-new "employees" table plus a nullable EmployeeId column on the existing "expenses"
    // table, neither of which EnsureCreated will add to an already-existing database. No FK
    // constraint on expenses.EmployeeId, matching the same tradeoff already accepted above.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS employees (
                "Id" SERIAL PRIMARY KEY,
                "Name" character varying(200) NOT NULL,
                "Phone" character varying(30) NULL,
                "Notes" character varying(500) NULL,
                "IsActive" boolean NOT NULL DEFAULT TRUE,
                "CreatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                "CreatedByUserId" integer NULL,
                "UpdatedAt" timestamp with time zone NULL,
                "UpdatedByUserId" integer NULL,
                "IsDeleted" boolean NOT NULL DEFAULT FALSE
            );
            ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "EmployeeId" integer NULL;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to create the employees table / EmployeeId column — the Employees page and linking expenses to employees will not work until this is fixed.");
    }

    // Same EnsureCreated gap as above: Partner.OpeningBalance ("الرصيد الافتتاحي") is a new column
    // on the existing "partners" table.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE partners ADD COLUMN IF NOT EXISTS "OpeningBalance" numeric(14,2) NULL;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the partners.OpeningBalance column — recording an opening balance for a farmer/driver/merchant will not work until this is fixed.");
    }

    // FarmerTransaction.Invoice went from a one-to-one relationship to one-to-many (an invoice can
    // now carry BOTH a farmer's Sale row and a driver's TransportFee row — see
    // FarmerTransactionType.TransportFee / Invoice.FarmerTransactions). EnsureCreatedAsync only
    // ever builds a table from the CURRENT model on a brand-new database, so a database that
    // already had "farmer_transactions" still has the OLD one-to-one mapping's UNIQUE index on
    // "InvoiceId" sitting there physically — which would reject a driver's TransportFee row the
    // moment an invoice already has a farmer's Sale row. This finds and drops any such unique
    // index by inspecting the catalog (rather than guessing EF's auto-generated name, which can
    // vary), then makes sure a plain non-unique index still exists so invoice-scoped lookups
    // (existingSale/existingTransportFee in InvoiceService) stay fast.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            DO $$
            DECLARE
                idx RECORD;
            BEGIN
                FOR idx IN
                    SELECT indexname FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'farmer_transactions'
                      AND indexdef ILIKE '%UNIQUE%'
                      AND indexdef ILIKE '%"InvoiceId"%'
                LOOP
                    EXECUTE format('DROP INDEX IF EXISTS %I', idx.indexname);
                END LOOP;
            END $$;

            CREATE INDEX IF NOT EXISTS ix_farmer_transactions_invoiceid_nonunique ON farmer_transactions ("InvoiceId");
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to drop the stale unique index on farmer_transactions.InvoiceId — an invoice with both a farmer and a driver+transport-fee attached will fail to save until this is fixed.");
    }

    // Same EnsureCreated gap as above: Partner.Address ("العنوان") is a new column on the existing
    // "partners" table — plain optional free text, no dependent calculation.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE partners ADD COLUMN IF NOT EXISTS "Address" text NULL;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the partners.Address column — recording an address for a farmer/driver/merchant will not work until this is fixed.");
    }

    // Same EnsureCreated gap as "employees" above: the new "goods stock" feature (بضاعة الباعة —
    // "إضافة بضاعة") needs a brand-new "farmer_goods_entries" table, which EnsureCreated will not
    // add to an already-existing database. No FK constraint on FarmerId, same tradeoff already
    // accepted for employees/expenses above.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS farmer_goods_entries (
                "Id" SERIAL PRIMARY KEY,
                "FarmerId" integer NOT NULL,
                "Date" timestamp with time zone NOT NULL,
                "ItemName" character varying(200) NOT NULL,
                "Unit" integer NOT NULL,
                "Quantity" numeric(14,3) NOT NULL DEFAULT 0,
                "WoodQuantity" numeric(14,3) NOT NULL DEFAULT 0,
                "Notes" character varying(500) NULL,
                "CreatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                "CreatedByUserId" integer NULL,
                "UpdatedAt" timestamp with time zone NULL,
                "UpdatedByUserId" integer NULL,
                "IsDeleted" boolean NOT NULL DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS ix_farmer_goods_entries_farmerid ON farmer_goods_entries ("FarmerId");
            CREATE INDEX IF NOT EXISTS ix_farmer_goods_entries_date ON farmer_goods_entries ("Date");
            CREATE INDEX IF NOT EXISTS ix_farmer_goods_entries_itemname ON farmer_goods_entries ("ItemName");
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to create the farmer_goods_entries table — recording/viewing a farmer's incoming goods stock will not work until this is fixed.");
    }

    // Same EnsureCreated gap as above: the new "checks" feature (a payment can now be recorded as a
    // check with a due date/number/clearance status, and several Payment rows can settle one
    // invoice with different methods at once) needs three new nullable columns on the existing
    // "payments" table. No FK/enum constraint on CheckStatus — same tradeoff already accepted for
    // every other guard here; the application layer is what enforces its valid values.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS "CheckDueDate" timestamp with time zone NULL;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS "CheckNumber" character varying(50) NULL;
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS "CheckStatus" integer NULL;
            CREATE INDEX IF NOT EXISTS ix_payments_checkduedate ON payments ("CheckDueDate");
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the payments.CheckDueDate/CheckNumber/CheckStatus columns — recording/tracking checks (الشيكات) will not work until this is fixed.");
    }

    // Same EnsureCreated gap as above: Payment.CheckClearedDate ("تاريخ الصرف الفعلي") is a new
    // column on the existing "payments" table, added right after the three checks columns above.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE payments ADD COLUMN IF NOT EXISTS "CheckClearedDate" timestamp with time zone NULL;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the payments.CheckClearedDate column — recording the actual clearing date of a check will not work until this is fixed.");
    }

    // Same EnsureCreated gap as the guards above: the per-invoice settlement work needs a new
    // column on "invoices", "مرتجع بضاعة" needs two new tables, and the abandoned "خصم" column
    // needs dropping.
    //
    // GrandTotal is BACKFILLED for every existing invoice in the same statement that adds it —
    // it is what every balance in the app now sums (see Invoice.GrandTotal), so leaving old rows
    // at 0 would read as "every historical invoice charged nothing". The backfill recomputes the
    // exact same formula InvoiceCharge does: product value + transport + the invoice's own wood
    // total + its box count × its locked-in box price, with no returns (they did not exist
    // before this migration, so that term is 0 for every historical row).
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            -- "خصم" is gone: the market never gave a buyer a flat concession on the invoice — a
            -- price concession is made by editing the item's own price, and the one real case for
            -- the word (compensating a seller when an item's price collapsed) is money moving to
            -- the SELLER, which this column never did. Dropped rather than left in place: the
            -- column is NOT NULL and the model no longer writes it, so leaving it would depend on
            -- its DEFAULT forever, and it would keep reading as a supported feature. Use a ledger
            -- adjustment on the partner's account for a real concession.
            ALTER TABLE invoices DROP COLUMN IF EXISTS "Discount";
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "GrandTotal" numeric(14,2) NOT NULL DEFAULT 0;
            CREATE INDEX IF NOT EXISTS ix_invoices_merchantid_status ON invoices ("MerchantId", "Status");

            CREATE TABLE IF NOT EXISTS goods_returns (
                "Id" serial PRIMARY KEY,
                "InvoiceId" integer NOT NULL REFERENCES invoices ("Id"),
                "Date" timestamp with time zone NOT NULL,
                "Reason" character varying(500) NULL,
                "TotalValue" numeric(14,2) NOT NULL DEFAULT 0,
                "CommissionRateApplied" numeric(6,4) NOT NULL DEFAULT 0,
                "RecordedByUserId" integer NOT NULL,
                "CreatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                "CreatedByUserId" integer NULL,
                "UpdatedAt" timestamp with time zone NULL,
                "UpdatedByUserId" integer NULL,
                "IsDeleted" boolean NOT NULL DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS ix_goods_returns_invoiceid ON goods_returns ("InvoiceId");
            CREATE INDEX IF NOT EXISTS ix_goods_returns_date ON goods_returns ("Date");

            CREATE TABLE IF NOT EXISTS goods_return_items (
                "Id" serial PRIMARY KEY,
                "GoodsReturnId" integer NOT NULL REFERENCES goods_returns ("Id") ON DELETE CASCADE,
                "ItemName" character varying(200) NOT NULL,
                "Quantity" numeric(14,3) NOT NULL DEFAULT 0,
                "Unit" integer NOT NULL DEFAULT 1,
                "PricePerUnit" numeric(14,2) NOT NULL DEFAULT 0,
                "LineTotal" numeric(14,2) NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS ix_goods_return_items_returnid ON goods_return_items ("GoodsReturnId");

            UPDATE invoices i
            SET "GrandTotal" = i."TotalValue" + i."TransportFee" + COALESCE(lines.wood, 0) + (COALESCE(lines.boxes, 0) * i."BoxPriceApplied")
            FROM (
                SELECT "InvoiceId",
                       SUM("WoodPrice") AS wood,
                       SUM(CASE WHEN "Unit" = 2 THEN "Quantity" ELSE 0 END) AS boxes
                FROM invoice_items GROUP BY "InvoiceId"
            ) AS lines
            WHERE lines."InvoiceId" = i."Id" AND i."GrandTotal" = 0;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the invoices.GrandTotal column, drop the obsolete Discount column, or create the goods-return tables — per-invoice payment status and مرتجع بضاعة will not work until this is fixed.");
    }
    // "صناديق مطلوبة من المشتري" grew into "الصناديق والمخالات": the same idea, but tracked for
    // sellers and drivers as well as buyers, in both directions, and for more than one kind of
    // container. That is the SAME table with two more columns, not a new one beside it — a second
    // table for one idea is how two views of it end up disagreeing.
    //
    // Every existing row is a crate coming back from a buyer, which is exactly what the defaults
    // below say, so nothing needs converting. Renaming first and adding columns second is
    // idempotent in either order on a re-run: the rename is skipped once the new name exists, and
    // ADD COLUMN IF NOT EXISTS is a no-op after the first time.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE IF EXISTS box_returns RENAME TO container_movements;
            ALTER TABLE IF EXISTS container_movements ADD COLUMN IF NOT EXISTS "Type" integer NOT NULL DEFAULT 1;
            ALTER TABLE IF EXISTS container_movements ADD COLUMN IF NOT EXISTS "Direction" integer NOT NULL DEFAULT 2;
            CREATE INDEX IF NOT EXISTS ix_container_movements_partnerid_type ON container_movements ("PartnerId", "Type");
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to migrate box_returns into container_movements — the الصناديق والمخالات screen will not work until this is fixed.");
    }

    // أجرة النقل moved sides: it is what it costs the SELLER to get his produce to market, so it
    // comes off his due and goes to the driver, and the BUYER is not charged for it at all. It
    // used to sit in the buyer's stored GrandTotal and nowhere on the seller's ledger, so both
    // need correcting on rows written before the change.
    //
    // RECOMPUTED from figures already on the rows, never adjusted by a delta — a subtraction is
    // right exactly once, a recompute is right however many times it runs, and this executes on
    // every startup. The WHERE on each makes a settled row a no-op.
    try
    {
        // Buyer: produce + wood + boxes × their own locked-in box price, less anything returned.
        // Exactly InvoiceCharge.ForMerchant, in SQL.
        var rebilled = await db.Database.ExecuteSqlRawAsync("""
            WITH computed AS (
                SELECT i."Id",
                       i."TotalValue" + COALESCE(lines.wood, 0)
                                      + (COALESCE(lines.boxes, 0) * i."BoxPriceApplied")
                                      - COALESCE(ret.returned, 0) AS total
                FROM invoices i
                LEFT JOIN (
                    SELECT "InvoiceId",
                           SUM("WoodPrice") AS wood,
                           SUM(CASE WHEN "Unit" = 2 THEN "Quantity" ELSE 0 END) AS boxes
                    FROM invoice_items GROUP BY "InvoiceId"
                ) AS lines ON lines."InvoiceId" = i."Id"
                LEFT JOIN (
                    SELECT "InvoiceId", SUM("TotalValue") AS returned
                    FROM goods_returns WHERE NOT "IsDeleted" GROUP BY "InvoiceId"
                ) AS ret ON ret."InvoiceId" = i."Id"
            )
            UPDATE invoices i
            SET "GrandTotal" = c.total
            FROM computed c
            WHERE c."Id" = i."Id" AND i."GrandTotal" <> c.total;
            """);
        if (rebilled > 0)
            app.Logger.LogWarning(
                "Recomputed {Count} invoice total(s) after أجرة النقل stopped being charged to the buyer — those buyers were billed for transport that is the seller's.",
                rebilled);

        // Seller: sale value − commission − the transport on that invoice. Exactly
        // InvoiceCharge.ForSeller. Type 1 = Sale; a Sale row always has an InvoiceId.
        var reduced = await db.Database.ExecuteSqlRawAsync("""
            UPDATE farmer_transactions ft
            SET "Amount" = ft."SaleValue" - ft."Commission" - i."TransportFee"
            FROM invoices i
            WHERE ft."InvoiceId" = i."Id"
              AND ft."Type" = 1
              AND ft."Amount" <> ft."SaleValue" - ft."Commission" - i."TransportFee";
            """);
        if (reduced > 0)
            app.Logger.LogWarning(
                "Corrected {Count} seller ledger row(s) for أجرة النقل, which now comes off the seller.",
                reduced);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to move أجرة النقل from the buyer's total onto the seller's ledger — buyers stay over-billed and sellers over-credited by the transport fee until this is fixed.");
    }

    // Correction for the wood price having been paid out twice. سعر الخشب is charged to the buyer
    // once, and it belongs to the DRIVER, who supplies and handles the crates (see InvoiceCharge).
    // It used to be added to the SELLER's ledger row as well, so every invoice carrying both a
    // seller and a driver paid a single charge out to two people — money the market never
    // collected, sitting in sellers' balances as if it were owed to them.
    //
    // A Sale row's amount is fully derivable from figures stored on the row itself: net due is the
    // sale value minus the commission, and neither of those was ever wrong. So this RECOMPUTES
    // rather than subtracting the wood back off — subtracting is only correct once, and a
    // recompute is correct however many times it runs. The WHERE makes a re-run a no-op, and
    // nothing outside seller Sale rows is touched: driver rows (TransportFee), payments and manual
    // adjustments are all left exactly as they are. Type 1 = Sale.
    try
    {
        var corrected = await db.Database.ExecuteSqlRawAsync("""
            UPDATE farmer_transactions
            SET "Amount" = "SaleValue" - "Commission"
            WHERE "Type" = 1
              AND "Amount" <> "SaleValue" - "Commission";
            """);
        if (corrected > 0)
            app.Logger.LogWarning(
                "Corrected {Count} seller ledger row(s) that had the wood price added to them — سعر الخشب is the driver's, and those sellers' balances were overstated by it.",
                corrected);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to correct seller ledger rows that double-counted سعر الخشب — affected sellers' balances stay overstated until this is fixed.");
    }

    // One-time data backfill for the "a check only counts once it has cleared" rule (see
    // Domain/Services/PaymentRules). The merchant side recomputes its balance from the payments
    // table on every read, so it picked the new rule up for free — but a payment TO a farmer or
    // driver posts a STORED farmer_transactions row, and every uncleared check recorded before
    // this change is still sitting there at its full amount, showing those people as paid when
    // they haven't been. This zeroes exactly those rows: the same thing PaymentService.UpdateAsync
    // now does whenever such a payment is saved, applied to the ones that predate it. Marking the
    // check Cleared later restores the real amount, as it would for any other check.
    //
    // Idempotent (the Amount <> 0 guard makes a re-run a no-op) and narrow — it never touches a
    // cash payment, a cleared check, or any non-Payment ledger row. CheckStatus 2 = Cleared.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE farmer_transactions ft
            SET "Amount" = 0
            FROM payments p
            WHERE ft."PaymentId" = p."Id"
              AND p."CheckStatus" IS NOT NULL
              AND p."CheckStatus" <> 2
              AND ft."Amount" <> 0;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to zero out farmer/driver ledger rows for checks that have not cleared — their balances may still count an uncleared check as paid until this is fixed.");
    }

    // Same EnsureCreated gap as above: the new automatic "سعر الصندوق" (per-box fee) feature needs
    // Invoice.BoxPriceApplied — the box-price rate locked in at creation time, same convention as
    // CommissionRateApplied — on the existing "invoices" table.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "BoxPriceApplied" numeric(8,2) NOT NULL DEFAULT 0;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the invoices.BoxPriceApplied column — the automatic per-box fee will not work until this is fixed.");
    }

    // Driver-side counterpart of the guard above: the new automatic "أجرة الصناديق" (per-box driver
    // handling fee) feature needs Invoice.DriverBoxFeeApplied — the rate locked in at creation time,
    // same convention as BoxPriceApplied/CommissionRateApplied — on the existing "invoices" table.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "DriverBoxFeeApplied" numeric(8,2) NOT NULL DEFAULT 0;
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to add the invoices.DriverBoxFeeApplied column — the automatic driver box-handling fee will not work until this is fixed.");
    }

    // Same EnsureCreated gap as "employees"/"farmer_goods_entries" above: the new "boxes owed"
    // feature (a merchant's running empty-crate balance) needs a brand-new "box_returns" table,
    // which EnsureCreated will not add to an already-existing database. No FK constraint on
    // PartnerId, same tradeoff already accepted for every other guard here.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS box_returns (
                "Id" SERIAL PRIMARY KEY,
                "PartnerId" integer NOT NULL,
                "Date" timestamp with time zone NOT NULL,
                "Quantity" numeric(14,3) NOT NULL DEFAULT 0,
                "Notes" character varying(500) NULL,
                "RecordedByUserId" integer NOT NULL DEFAULT 0,
                "CreatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                "CreatedByUserId" integer NULL,
                "UpdatedAt" timestamp with time zone NULL,
                "UpdatedByUserId" integer NULL,
                "IsDeleted" boolean NOT NULL DEFAULT FALSE
            );
            CREATE INDEX IF NOT EXISTS ix_box_returns_partnerid ON box_returns ("PartnerId");
            CREATE INDEX IF NOT EXISTS ix_box_returns_date ON box_returns ("Date");
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to create the box_returns table — recording/viewing a merchant's empty-crate returns will not work until this is fixed.");
    }

    // Composite index matching the actual query pattern: every farmer/driver statement (كشف حساب)
    // filters by FarmerId and orders by Date together — previously only single-column indexes
    // existed on each separately, so this most-common lookup got progressively slower as
    // farmer_transactions grew instead of using one index for both parts of the query.
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS ix_farmer_transactions_farmerid_date ON farmer_transactions ("FarmerId", "Date");
            """);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to create the composite (FarmerId, Date) index on farmer_transactions — statements will still work correctly, just slower as the table grows.");
    }

    await DbSeeder.SeedAsync(db);

    // One-time correction: the actual market commission is 10%, but this system originally
    // seeded (and every invoice before this fix locked in) 7% — DbSeeder's own seed is guarded
    // by an existence check, so it never touches a database that already has this row. Only
    // flips it when it's still sitting at exactly the old wrong default; an admin who has since
    // deliberately set some OTHER rate via the Settings screen is left untouched. Does not
    // retroactively change CommissionRateApplied on invoices already issued at 7% — only the
    // rate new invoices will use from now on.
    try
    {
        var commissionSetting = await db.Settings.SingleOrDefaultAsync(s => s.Key == Setting.Keys.DefaultCommissionRate);
        if (commissionSetting is not null && commissionSetting.Value == "0.10")
        {
            commissionSetting.Value = "0.10";
            commissionSetting.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to correct the default commission rate from 7% to 10% — check/update it manually from الإعدادات if it's still wrong.");
    }
}

// ---------- Middleware pipeline ----------
app.UseMiddleware<ExceptionHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
// Re-validates the live user record (IsActive, MustChangePassword, current permissions) on every
// authenticated request — see LiveUserStateMiddleware's own doc comment for exactly which audit
// findings this closes. Placed after authentication (context.User must be populated) but before
// authorization (a stale/deactivated/must-change-password session is rejected before the
// [RequirePermission] policy checks even run).
app.UseMiddleware<LiveUserStateMiddleware>();
app.UseAuthorization();
app.MapControllers();

// ---------- Health ----------
// ONE endpoint, at /health, and it is the only one. Everything that asks about this API's health
// asks for this exact path: nginx.conf's `location = /health`, the container healthcheck in
// deploy/compose/prod.yml and env.yml, and the deploy gate in deploy/scripts/portainer.sh (which
// polls it through the public hostname and needs three consecutive 200s to call a rollout good).
// Anonymous so an external uptime monitor can poll it with no credentials; nothing sensitive is
// returned.
//
// It reports the database, not just "the process is up". Every screen in this app needs Postgres,
// so an API that answers requests but cannot reach the database is a full outage — and that is a
// rollout the gate SHOULD fail. There is no separate dependency-free liveness probe because there
// is nothing here to act on one differently: a single container, one replica, behind one nginx,
// with `restart: unless-stopped`, so nothing restarts or de-registers on an unhealthy status. That
// split earns its keep under an orchestrator; here it was only a second thing to keep in sync.
// The false-failure worry it was meant to answer does not apply either: `depends_on: db:
// service_healthy` plus EnsureCreatedAsync above mean the database has already been reached
// successfully before this line can ever run.
//
// Renaming or removing this fails no build and no test. It fails every deploy, seven minutes in,
// as a health-gate timeout that reads like a networking problem — while the site itself looks
// perfectly fine, because nginx routes / and /api/ correctly and only the probe path 404s. That
// has now happened three times: dropped in 1c712fb, restored in 9290402, then moved to /api/health
// in c2627fb, which is what broke the deploy of 2f38ac2. If it has to move, move the six callers
// listed above in the same commit.
app.MapGet("/health", async (GreenMarket.Infrastructure.Persistence.AppDbContext db) =>
{
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1");
        return Results.Ok(new { status = "ok", database = "reachable", timeUtc = DateTimeOffset.UtcNow });
    }
    catch (Exception ex)
    {
        return Results.Json(new { status = "degraded", database = "unreachable", error = ex.Message }, statusCode: 503);
    }
}).AllowAnonymous();

app.Run();
