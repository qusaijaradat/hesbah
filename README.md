# Green Market Management System — نظام إدارة حسبة خضار

A full-stack implementation of the requirements document (`green_market_requirements.pdf`):
an electronic system for a vegetable wholesale market ("hasbeh") to manage produce
coming in from farmers, sales to merchants, invoices, payments, farmer commission
accounting, and reports.

## Tech stack

| Layer      | Choice                                              |
|------------|------------------------------------------------------|
| Backend    | ASP.NET Core Web API + C# (.NET 8)                   |
| Frontend   | React + TypeScript (Vite), Arabic RTL UI, Tailwind   |
| Database   | **PostgreSQL** (see rationale below)                 |
| ORM        | Entity Framework Core                                |
| Auth       | JWT + role/permission-based authorization            |
| Reports    | ClosedXML (Excel) + QuestPDF (PDF)                   |

Backend framework, frontend framework, ORM, and auth approach all follow the
requirement doc's own "§12 Proposed Technologies" section exactly. The one open
decision the doc left to the implementer was the **database engine** (it said "SQL
Server" but this was clearly a suggestion, not a hard requirement) —

### Why PostgreSQL instead of SQL Server

- **Zero licensing cost** — matters for a small, single-location business; SQL Server's
  free tier (Express) has a 10GB database size cap and feature limits that don't apply
  to Postgres.
- **First-class EF Core support** via Npgsql — same developer experience, same LINQ
  queries, no compromise.
- **Cheaper to host long-term** — nearly every VPS/cloud provider offers managed
  Postgres at a lower price point than managed SQL Server, and self-hosting Postgres on
  a small Linux box (which is likely, for a single vegetable market) is simpler and
  lighter than SQL Server on Linux.
- If a future requirement genuinely needs SQL Server (e.g. integrating with existing
  Windows/SQL Server infrastructure), swapping the `Npgsql.EntityFrameworkCore.PostgreSQL`
  package for `Microsoft.EntityFrameworkCore.SqlServer` and updating the connection
  string is the only change needed — the rest of the codebase (entities, business logic,
  controllers) is 100% database-agnostic.

## Project structure

```
GreenMarket/
├── backend/
│   ├── src/
│   │   ├── GreenMarket.Domain/          # entities + pure business logic (no dependencies)
│   │   ├── GreenMarket.Infrastructure/  # EF Core, PostgreSQL, repositories, seeding
│   │   └── GreenMarket.Api/             # controllers, JWT auth, DTOs, PDF/Excel export
│   └── tools/SmokeTests/                # zero-dependency console harness for Domain logic
├── database/
│   ├── schema.sql                       # hand-authored DDL bootstrap (see docs/DEVELOPMENT_NOTES.md)
│   └── seed.sql
├── frontend/                            # React + TypeScript (Vite), Arabic RTL
├── deploy/                              # Portainer stacks + deploy scripts (see deploy/README.md)
│   ├── compose/nonprod-shared.yml       # preview router + shared Postgres
│   ├── compose/env.yml                  # one non-prod environment: dev, or a PR preview
│   ├── compose/env-reap.yml             # drops a closed PR's database
│   ├── compose/prod.yml                 # the production stack
│   └── scripts/                         # portainer.sh + one-time bootstrap
├── .github/workflows/                   # review, build, deploy-dev, deploy-prod, preview, teardown
├── docker-compose.yml                   # Postgres + API + frontend, one command
└── docs/DEVELOPMENT_NOTES.md            # what was/wasn't build-verified, and why
```

## Quick start (Docker Compose)

```bash
cp backend/src/GreenMarket.Api/appsettings.json backend/src/GreenMarket.Api/appsettings.Production.json # optional, or just set env vars below
docker compose up --build
```

This starts Postgres, the API (`http://localhost:5080`, Swagger UI at `/swagger` in
Development), and the frontend (`http://localhost:5173`). Override the defaults with
environment variables before running: `POSTGRES_PASSWORD`, `JWT_SIGNING_KEY` (use a
long random string in anything beyond local dev).

**Default login:** `admin` / `ChangeMe123!` — change this immediately after first login
(there's no "force change on first login" flow yet; see Future Features below).

## Manual setup (without Docker)

```bash
# 1. Database
createdb greenmarket   # or use database/schema.sql + database/seed.sql directly with psql

# 2. Backend
cd backend
dotnet restore
# edit src/GreenMarket.Api/appsettings.Development.json with your connection string
dotnet run --project src/GreenMarket.Api
# EnsureCreated + the seeder run automatically on first startup (roles, permissions,
# the admin user, default settings) — no manual migration step needed yet.

# 3. Frontend
cd frontend
npm install
cp .env.example .env   # point VITE_API_URL at your running API
npm run dev
```

## CI/CD

| Trigger | Workflow | What happens |
|---|---|---|
| Pull request | `review.yml` | Backend builds and its domain smoke tests run; frontend lints, typechecks and builds; both Docker images build (nothing is pushed). |
| Pull request | `preview.yml` | A live preview at `https://pr-<n>.<base-domain>`, with its own database. The URL is posted as a PR comment. |
| PR closed | `preview-teardown.yml` | Destroys the preview's containers, drops its database, and prunes the images it left on the host. |
| Push to `develop` | `deploy-dev.yml` | Review → publish → deploy `hesbah-dev` → wait for `https://dev.<base-domain>/health` → prune. |
| Push to `main` | `deploy-prod.yml` | The same, against the production stack and `https://<base-domain>/health`. |
| Push of a `v*` tag | `build.yml` | Publishes an immutable release image. Deploys nothing. |

Dev and PR previews are deployed from the **same compose file**, so every
preview is a rehearsal of the dev deploy. A shared nginx router turns the
subdomain (`dev.`, `pr-<n>.`) into a container name over Docker's embedded
DNS, so bringing a preview up or down needs no configuration change anywhere —
and the domain itself lives only in the `HESBAH_BASE_DOMAIN` GitHub variable,
never in this repository.

A deploy always names an exact image tag (the 7-character commit SHA), never
`latest`, and only goes green once the public health endpoint has answered
`200` three times in a row — so a crash-looping rollout fails the run instead
of quietly leaving the environment down.

**Rolling back** is running the deploy workflow again from the Actions tab with
`image_tag` set to an older short SHA. No revert commit, no rebuild.

Setup — the GitHub variables and secrets, the edge proxy vhosts, and the
one-time `bootstrap-nonprod.sh` run — is in [deploy/README.md](deploy/README.md).

## Feature checklist against the requirement document

| § | Requirement | Status |
|---|---|---|
| 1 | Online, multi-user, multi-device system | ✅ |
| 2 | Login required, user management, role/permission model | ✅ (4 seeded roles: Admin, HasbehEmployee, Accountant, Viewer — fully editable) |
| 3 | Unified farmers/merchants table, name-suggestion autocomplete, WhatsApp number as ID | ✅ |
| 4 | Sales invoice with per-item weight/price/total, auto totals | ✅ |
| 5 | Hidden commission (configurable rate, default 7%), farmer net due | ✅ — verified against the doc's own ₪10,000/₪700/₪9,300 example |
| 6 | Merchant/farmer accounts, payments, account statements | ✅ |
| 7 | Filterable/searchable invoices (date, partner, item, user, number, weight, amount) | ✅ |
| 8 | Farmer/merchant/market reports, filterable + printable + exportable | ✅ |
| 9 | Thermal (80mm) / A4 printing, PDF generation, WhatsApp send | PDF generation ✅; direct WhatsApp Business API send is a stub — see below |
| 10 | Responsive, mobile-first, works on desktop/tablet/mobile | ✅ (Tailwind responsive layout) |
| 11 | Online-first architecture, Offline Mode as a later option | Online ✅; Offline Mode intentionally not built (doc marks it optional/future) |
| 12 | Proposed tech stack | ✅ (Postgres substituted for SQL Server — see rationale above) |
| 13 | Main tables | ✅ all eleven tables (Users, Roles, Permissions, Partners, Invoices, InvoiceItems, FarmerTransactions, Payments, Expenses, Settings, AuditLogs) |
| 14 | Future features | AuditLogs promoted into this initial build (see below); the rest listed as future work |

### Why AuditLogs was promoted out of "future features"

The doc lists "a complete record for every edit, who made it and when" under §14
(future). It was pulled into this initial build anyway because it's cheap to get right
from day one (one EF Core `SaveChangesInterceptor`, in `AuditSaveChangesInterceptor.cs`)
and expensive to retrofit later once real transaction history exists that would need
backfilling.

### Genuinely deferred to future work (per §14, as written)

- Electronic scale integration
- QR codes on invoices
- Native mobile app (the current frontend is responsive/mobile-web, not a packaged app)
- Multi-branch support
- Automatic backups (infrastructure/ops concern, not application code)
- Direct WhatsApp Business API send — the API generates the invoice PDF
  (`GET /api/invoices/{id}/pdf`); wiring that to WhatsApp Business's API needs a Meta
  Business account and API credentials that only the market owner can provision, so the
  frontend currently just downloads the PDF for manual sending.
- Offline Mode (local storage + sync on reconnect) — doc explicitly frames this as
  optional/future, so it wasn't built.
- Force-password-change-on-first-login for the seeded admin account.

## An honest note on verification

Everything above was written carefully, but not everything could be *compiled* in the
sandbox this was built in — that environment's network allow-list didn't include
nuget.org or Docker Hub. What was and wasn't actually run (and how the parts that
couldn't be run were still checked for consistency) is documented in
**`docs/DEVELOPMENT_NOTES.md`** — worth reading before your first `dotnet restore` if
something doesn't build on the first try.

## License note

QuestPDF (used for PDF export) is free under its Community license for companies under
roughly $1M USD annual revenue — fine for a single local market, but re-check
[questpdf.com/pricing](https://questpdf.com/pricing) if this ever changes.
