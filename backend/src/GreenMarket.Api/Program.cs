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

// Must run before any PDF is generated — see PdfFontRegistration.cs for why "Tahoma" (used by
// every ExportService PDF) needs to be backed by a bundled font rather than the OS's own fonts.
PdfFontRegistration.RegisterBundledFonts();

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
builder.Services.AddScoped<IExpenseService, ExpenseService>();
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
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS company_logos (
            "Id" integer NOT NULL PRIMARY KEY,
            "Content" bytea NOT NULL,
            "ContentType" character varying(100) NOT NULL,
            "UpdatedAt" timestamp with time zone NOT NULL,
            "UpdatedByUserId" integer NULL
        );
        """);

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

// ---------- Health ----------
// Anonymous and dependency-free on purpose. The deploy pipeline polls this
// through the public hostname to decide whether a rollout succeeded
// (deploy/scripts/portainer.sh), and the container healthcheck polls it
// locally — so it must answer 200 as soon as the app can serve requests, and
// must not depend on anything that could make a healthy API look unhealthy.
// The database is not probed here: schema creation and seeding already ran
// above, so reaching this line at all means the connection worked.
//
// Removing this endpoint does not fail a build or a test — it fails every
// deploy, several minutes in, as a health-gate timeout that looks like a
// networking problem. It was dropped once already in 1c712fb.
app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.Run();
