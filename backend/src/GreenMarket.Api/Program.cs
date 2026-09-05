using System.Text;
using System.Text.Json.Serialization;
using GreenMarket.Api.Auth;
using GreenMarket.Api.Common;
using GreenMarket.Api.Services;
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
builder.Services.AddScoped<IBoxReturnService, BoxReturnService>();
builder.Services.AddScoped<IExpenseService, ExpenseService>();
builder.Services.AddScoped<IEmployeeService, EmployeeService>();
builder.Services.AddScoped<IGoodsService, GoodsService>();
builder.Services.AddScoped<IReportService, ReportService>();
builder.Services.AddScoped<ISettingsService, SettingsService>();
builder.Services.AddScoped<ICompanyLogoService, CompanyLogoService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
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

    await DbSeeder.SeedAsync(db);
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
app.UseAuthorization();
app.MapControllers();

app.Run();
