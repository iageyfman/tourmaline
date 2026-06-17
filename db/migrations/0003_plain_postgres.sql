-- Tourmaline now runs against plain Postgres through DATABASE_URL.
--
-- This migration slot used to contain provider-specific grants. A normal Postgres
-- setup does not need them, so the migration is intentionally a no-op.
select 1;
