-- GreenMarket Management System — PostgreSQL schema
-- Mirrors backend/src/GreenMarket.Domain/Entities exactly (see requirement doc §13
-- "Main Tables": Users, Roles, Permissions, Partners, Invoices, InvoiceItems,
-- FarmerTransactions, Payments, Expenses, Settings, AuditLogs).
--
-- This file is a hand-authored, immediately-runnable bootstrap so the schema can be
-- verified without the .NET EF Core CLI tools (which need a NuGet restore). Once you
-- have normal internet access, generate the "real" EF Core migration with:
--   dotnet ef migrations add InitialCreate --project backend/src/GreenMarket.Infrastructure --startup-project backend/src/GreenMarket.Api
-- and EF will produce SQL equivalent to this file (safe to diff against it).

BEGIN;

-- Enables fast fuzzy/partial name matching for the "suggest existing names while
-- typing" requirement (§3) via a trigram GIN index below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE roles (
    id                    SERIAL PRIMARY KEY,
    name                  VARCHAR(100) NOT NULL UNIQUE,
    description           VARCHAR(500),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id    INTEGER,
    updated_at            TIMESTAMPTZ,
    updated_by_user_id    INTEGER,
    is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE permissions (
    id                    SERIAL PRIMARY KEY,
    key                   VARCHAR(100) NOT NULL UNIQUE,
    description           VARCHAR(500),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id    INTEGER,
    updated_at            TIMESTAMPTZ,
    updated_by_user_id    INTEGER,
    is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE role_permissions (
    role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id                    SERIAL PRIMARY KEY,
    full_name             VARCHAR(200) NOT NULL,
    username              VARCHAR(100) NOT NULL UNIQUE,
    password_hash         VARCHAR(200) NOT NULL,
    password_salt         VARCHAR(200) NOT NULL,
    role_id               INTEGER NOT NULL REFERENCES roles(id),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    -- Security hardening: force a fresh password at next login whenever an admin sets/resets
    -- one (including the seeded default admin account), and lock the account out for a while
    -- after too many consecutive wrong passwords.
    must_change_password  BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id    INTEGER,
    updated_at            TIMESTAMPTZ,
    updated_by_user_id    INTEGER,
    is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_users_role_id ON users(role_id);

-- requirement doc §3: unified Partners table for farmers + merchants.
CREATE TABLE partners (
    id                    SERIAL PRIMARY KEY,
    name                  VARCHAR(200) NOT NULL,
    type                  SMALLINT,              -- 1=Farmer, 2=Merchant, 3=Both, NULL=unspecified
    whatsapp_number       VARCHAR(30),            -- the "approved number" (§3) and WhatsApp send target (§9)
    notes                 VARCHAR(1000),
    -- Optional soft ceiling on a merchant's outstanding balance; advisory only (see Partner.cs).
    credit_limit          NUMERIC(14,2),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id    INTEGER REFERENCES users(id),
    updated_at            TIMESTAMPTZ,
    updated_by_user_id    INTEGER REFERENCES users(id),
    is_deleted            BOOLEAN NOT NULL DEFAULT FALSE
);
-- name-suggestion lookup while typing (§3) + prevents near-duplicate entry mistakes.
CREATE INDEX ix_partners_name_trgm ON partners USING gin (name gin_trgm_ops);
CREATE INDEX ix_partners_type ON partners(type);

-- Growing produce/goods name catalog for the invoice item picker (mirrors partners' own
-- "type it once, pick it from a list every time after" pattern) — see GreenMarket.Domain.Entities.Item.
CREATE TABLE items (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_items_name_trgm ON items USING gin (name gin_trgm_ops);

CREATE TABLE invoices (
    id                        SERIAL PRIMARY KEY,
    invoice_number            VARCHAR(50) NOT NULL UNIQUE,
    date                      TIMESTAMPTZ NOT NULL,
    merchant_id               INTEGER NOT NULL REFERENCES partners(id),
    -- Nullable: an invoice can be entered for the trader alone — a farmer isn't always
    -- known/relevant at entry time (see Invoice.FarmerId doc comment).
    farmer_id                 INTEGER REFERENCES partners(id),
    status                    SMALLINT NOT NULL DEFAULT 1,   -- 1=Active, 2=Cancelled
    total_weight_kg           NUMERIC(14,3) NOT NULL DEFAULT 0,
    total_value               NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission_rate_applied   NUMERIC(6,4) NOT NULL,          -- e.g. 0.0700 for 7%, frozen at creation time
    cancelled_by_user_id      INTEGER REFERENCES users(id),
    cancelled_at              TIMESTAMPTZ,
    cancellation_reason       VARCHAR(500),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id        INTEGER REFERENCES users(id),
    updated_at                TIMESTAMPTZ,
    updated_by_user_id        INTEGER REFERENCES users(id),
    is_deleted                BOOLEAN NOT NULL DEFAULT FALSE
);
-- requirement doc §7 invoice filters: date range, merchant, farmer, invoice number, weight, amount.
CREATE INDEX ix_invoices_date ON invoices(date);
CREATE INDEX ix_invoices_merchant_id ON invoices(merchant_id);
CREATE INDEX ix_invoices_farmer_id ON invoices(farmer_id);
CREATE INDEX ix_invoices_status ON invoices(status);

CREATE TABLE invoice_items (
    id              SERIAL PRIMARY KEY,
    invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    item_name       VARCHAR(200) NOT NULL,
    quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit            SMALLINT NOT NULL DEFAULT 1,   -- 1=Kg, 2=Box — not everything is sold by weight
    price_per_unit  NUMERIC(14,2) NOT NULL CHECK (price_per_unit >= 0),
    line_total      NUMERIC(14,2) NOT NULL
);
-- requirement doc §7 filter by item name.
CREATE INDEX ix_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX ix_invoice_items_item_name ON invoice_items(item_name);

-- requirement doc §5/§6: the farmer+market-only internal ledger (never shown to merchants).
CREATE TABLE farmer_transactions (
    id            SERIAL PRIMARY KEY,
    farmer_id     INTEGER NOT NULL REFERENCES partners(id),
    type          SMALLINT NOT NULL,             -- 1=Sale, 2=Payment, 3=Adjustment
    invoice_id    INTEGER REFERENCES invoices(id),
    payment_id    INTEGER,                       -- FK added after payments table exists (see below)
    date          TIMESTAMPTZ NOT NULL,
    sale_value    NUMERIC(14,2) NOT NULL DEFAULT 0,
    commission    NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount        NUMERIC(14,2) NOT NULL,        -- signed: +net due (Sale), -amount (Payment)
    notes         VARCHAR(500)
);
CREATE INDEX ix_farmer_transactions_farmer_id ON farmer_transactions(farmer_id);
CREATE INDEX ix_farmer_transactions_date ON farmer_transactions(date);
CREATE INDEX ix_farmer_transactions_invoice_id ON farmer_transactions(invoice_id);

CREATE TABLE payments (
    id                     SERIAL PRIMARY KEY,
    partner_id             INTEGER NOT NULL REFERENCES partners(id),
    direction              SMALLINT NOT NULL,     -- 1=FromMerchant, 2=ToFarmer
    amount                 NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    date                   TIMESTAMPTZ NOT NULL,
    method                 VARCHAR(50),
    notes                  VARCHAR(500),
    recorded_by_user_id    INTEGER NOT NULL REFERENCES users(id),
    -- Optional link to the specific invoice this payment settles (roadmap feature); NULL keeps
    -- the previous behaviour of only reducing the partner's aggregate balance.
    invoice_id             INTEGER REFERENCES invoices(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id     INTEGER REFERENCES users(id),
    updated_at             TIMESTAMPTZ,
    updated_by_user_id     INTEGER REFERENCES users(id),
    is_deleted             BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_payments_partner_id ON payments(partner_id);
CREATE INDEX ix_payments_date ON payments(date);
CREATE INDEX ix_payments_invoice_id ON payments(invoice_id);

ALTER TABLE farmer_transactions
    ADD CONSTRAINT fk_farmer_transactions_payment
    FOREIGN KEY (payment_id) REFERENCES payments(id);

-- Internal staff (separate from partners/farmers/merchants) — added so expenses/withdrawals can
-- be attributed to a specific employee and tallied. A withdrawal ("سحب") is just an expense row
-- with employee_id set and, by convention, category='سحب' — no separate table for it.
CREATE TABLE employees (
    id                     SERIAL PRIMARY KEY,
    name                   VARCHAR(200) NOT NULL,
    phone                  VARCHAR(30),
    notes                  VARCHAR(500),
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id     INTEGER REFERENCES users(id),
    updated_at             TIMESTAMPTZ,
    updated_by_user_id     INTEGER REFERENCES users(id),
    is_deleted             BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_employees_name ON employees(name);

CREATE TABLE expenses (
    id                     SERIAL PRIMARY KEY,
    date                   TIMESTAMPTZ NOT NULL,
    description            VARCHAR(500) NOT NULL,
    amount                 NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    category               VARCHAR(100),
    recorded_by_user_id    INTEGER NOT NULL REFERENCES users(id),
    employee_id            INTEGER REFERENCES employees(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id     INTEGER REFERENCES users(id),
    updated_at             TIMESTAMPTZ,
    updated_by_user_id     INTEGER REFERENCES users(id),
    is_deleted             BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_expenses_date ON expenses(date);
CREATE INDEX ix_expenses_employee_id ON expenses(employee_id);

-- requirement doc §5: commission rate must be a configurable setting, not hard-coded.
CREATE TABLE settings (
    key                 VARCHAR(100) PRIMARY KEY,
    value               VARCHAR(500) NOT NULL,
    description         VARCHAR(500),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id  INTEGER REFERENCES users(id)
);

-- requirement doc §14 (promoted into the initial build): full edit history, who/when.
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id       INTEGER REFERENCES users(id),
    entity_name   VARCHAR(100) NOT NULL,
    entity_id     VARCHAR(50) NOT NULL,
    action        VARCHAR(50) NOT NULL,
    changes_json  TEXT
);
CREATE INDEX ix_audit_logs_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX ix_audit_logs_at ON audit_logs(at);

COMMIT;
