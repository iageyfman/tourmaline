# Security

## Security model — read this before deploying

tourmaline is a **single-user** application with **no authentication layer**.

All database access goes through trusted server-side code holding a Supabase
`service_role` key, which **bypasses Row Level Security**. There is no login,
no session, and no per-user authorization — the app assumes exactly one trusted
operator.

> [!WARNING]
> **Do not deploy this to a public URL as-is.** Because there is no
> authentication, anyone who can reach the deployment has full read/write/delete
> access to every note. Before exposing it beyond your own machine, put it behind
> access control — a Vercel password / SSO protection, an authenticating reverse
> proxy, a private network, or your own auth layer. For most people the safest
> setup is to run it **locally** (`npm run dev`).

## Secrets

- The `service_role` key is **server-only** and must never reach the browser or
  be committed. It lives in `.env.local`, which is gitignored — keep it that way.
- The publishable / anon key is safe to expose to the client; the service-role
  key is not.
- If a service-role key is ever leaked, rotate it immediately in the Supabase
  dashboard (Project Settings → API).

## Reporting a vulnerability

This is a personal project, not a supported product, but security reports are
welcome. Please use GitHub's **private vulnerability reporting** (the repository's
**Security** tab → **Report a vulnerability**) rather than opening a public issue,
so the report stays private until any fix is available.

Only the latest state of the `main` branch is maintained.
