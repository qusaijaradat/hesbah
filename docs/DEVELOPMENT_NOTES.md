# Development notes — how this project was built and verified

This project was scaffolded end-to-end in a sandboxed cloud environment with an
**allow-listed network** (only npm, PyPI, and a couple of other package registries were
reachable — **nuget.org and Docker Hub/mcr.microsoft.com were not**). That shaped what
could actually be *run* versus what could only be *written carefully*. Being upfront
about the difference matters more than pretending everything was compiled, so here is
exactly what was verified and how.

## What was actually built and run in that sandbox

- **`backend/src/GreenMarket.Domain`** — zero third-party dependencies by design, so it
  compiles anywhere. Built and ran successfully with `dotnet build`.
- **`backend/tools/SmokeTests`** — a small console harness (no xUnit — that also needs
  NuGet) with 16 hand-written assertions covering the commission calculation (including
  the exact ₪10,000 → ₪700 → ₪9,300 example from the requirement doc), invoice line-item
  totals, and account-statement running balances. Run with:
  ```
  dotnet run --project backend/tools/SmokeTests
  ```
  All 16 assertions pass.
- **`database/schema.sql` and `database/seed.sql`** — executed against a real local
  PostgreSQL 16 instance. Every table, index, foreign key, and check constraint in the
  file was created without error; seed data (roles, permissions, role-permission
  grants, default settings) was inserted and queried back successfully.
- **`frontend/`** — a real Vite + React + TypeScript app. `npm install`, `npm run build`
  (zero TypeScript errors), and a headless-browser pass over the login page and every
  protected page (dashboard, invoices, new-invoice form, partners, payments, reports,
  settings) confirmed the Arabic RTL layout renders correctly and nothing crashes —
  verified with a mocked auth session since no backend was reachable in that sandbox.

## What could NOT be restored/compiled in that sandbox

- **`backend/src/GreenMarket.Infrastructure`** (needs `Microsoft.EntityFrameworkCore`,
  `Npgsql.EntityFrameworkCore.PostgreSQL`) and **`backend/src/GreenMarket.Api`** (needs
  the JWT bearer package, Swashbuckle, ClosedXML, QuestPDF) — all straightforward NuGet
  packages, but `api.nuget.org` was unreachable from that sandbox (confirmed via
  `curl -v`, which showed the outbound proxy returning `403 Forbidden` specifically for
  that host, while `registry.npmjs.org` and `pypi.org` worked fine).
- Docker image builds (`mcr.microsoft.com/dotnet/...`, `postgres`, `node`, `nginx` base
  images) — Docker Hub / MCR were similarly unreachable, so `docker-compose.yml` and the
  two `Dockerfile`s are written to the standard multi-stage pattern but untested here.

**On literally any machine or CI runner with normal internet access, none of this is a
concern** — `dotnet restore` and `docker compose build` are just... the normal first
step. The code was written carefully (consistent namespaces double-checked with a repo-
wide grep, DI wiring cross-referenced against every constructor, EF Core fluent-API
calls matched 1:1 against `database/schema.sql` which *did* execute against real
Postgres) but if something doesn't compile on the first try, treat it like you would any
freshly-written code you're integrating for the first time — check the error, it's
almost certainly a small thing (a QuestPDF API surface that shifted between versions is
the most likely candidate; see the comment on `PageSize` in `ExportService.cs`).

## First real build, step by step

```bash
cd backend
dotnet restore
dotnet build
# EnsureCreated (see Program.cs) builds the schema from the model on first run — no
# migration step needed yet. To switch to versioned EF Core migrations later:
dotnet tool install --global dotnet-ef   # one-time
dotnet ef migrations add InitialCreate --project src/GreenMarket.Infrastructure --startup-project src/GreenMarket.Api
dotnet ef database update --project src/GreenMarket.Infrastructure --startup-project src/GreenMarket.Api
```

If `dotnet build` reports version-mismatch errors on the QuestPDF or ClosedXML package
versions pinned in `GreenMarket.Api.csproj`, bump them to whatever's current — those
version numbers were current at time of writing but this ecosystem moves fast.
