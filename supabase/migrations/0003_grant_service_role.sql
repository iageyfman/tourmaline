-- This project is hardened: new tables get RLS auto-enabled (the `ensure_rls` event
-- trigger) AND the API roles (anon / authenticated / service_role) receive NO default
-- table grants. The app reaches the DB only via the service_role key (trusted,
-- server-side, bypasses RLS), which therefore has NO privileges and fails with
-- "permission denied". Grant it access to the application tables (the 7 in `public`).
--
-- Scoped deliberately narrow: only the existing tables, no database-wide default
-- privileges. anon / authenticated stay ungranted and RLS-gated (locked to clients)
-- until an auth session adds policies. service_role bypasses RLS by design and its key
-- never reaches the browser, so this does not widen client-facing access.
-- NOTE: tables added later will each need their own grant (or opt into
-- `alter default privileges ... to service_role`).

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
