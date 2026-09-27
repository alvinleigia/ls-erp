# LS Salon

Multi-tenant salon SaaS built with Next.js, Prisma, Postgres, and tenant-scoped host routing.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file from `.env.example`.

Recommended local values:
- `DATABASE_URL` should point to a local Postgres database you create first.
- `APP_ROOT_DOMAIN=localhost` enables generated links such as `tenant-slug.localhost:3000`.
- `PLATFORM_ADMIN_*` values control the bootstrap tenant and first admin login.

For Supabase instead of local Postgres:
- use the `Transaction pooler` connection string on port `6543` for `DATABASE_URL`
- use direct or session-pooler port `5432` for Prisma migrations via `DIRECT_URL`
- existing shared-pooler `5432` URLs are mapped to `6543` by runtime only; tenant settings are transaction-local
- see `docs/SUPABASE_SETUP.md`

3. Create the database named in `DATABASE_URL`.

4. Run the Prisma migration:

```bash
npm run db:migrate
```

5. Bootstrap the platform tenant and platform admin:

```bash
npm run bootstrap:admin
```

6. Start the app:

```bash
npm run dev
```

## Local tenant URLs

With `APP_ROOT_DOMAIN=localhost`:
- Platform tenant: `http://localhost:3000/`
- Provisioned tenant example: `http://storefront1.localhost:3000/`

This codebase resolves tenant context from the request host. Normal tenant data is stored in shared tables and isolated with both:
- app-level `tenantId` filtering
- Postgres row-level security (RLS)

## Required environment variables

Required:
- `DATABASE_URL`

Recommended:
- `AUTH_SECRET`
- `APP_ROOT_DOMAIN`
- `PLATFORM_ADMIN_TENANT_SLUG`
- `PLATFORM_ADMIN_EMAIL`
- `PLATFORM_ADMIN_PASSWORD`

Optional:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `INVOICE_FONT_PATH`
- `INVOICE_HEADER_LINES`
- `NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY`

## Notes for this repo

- Multi-tenant conventions live in `docs/CONVENTIONS.md`.
- Prisma schema lives in `prisma/schema.prisma`.
- Tenant-safe Prisma context is handled in `lib/prisma.ts`.
- Platform provisioning APIs intentionally use a tightly scoped RLS bypass path.
- Supabase setup notes live in `docs/SUPABASE_SETUP.md`.
- Linked Chrome setup and saved-login browser tests are documented in `docs/BROWSER_TESTING.md`.

## Current status

The project folder is restored and the missing tracked config files are back.

What still blocks a full local run is environment setup:
- there is currently no `.env`
- `DATABASE_URL` is required during build/runtime

After creating `.env` and pointing `DATABASE_URL` at a live Postgres database, the next safe step is:

```bash
npm run db:migrate
npm run bootstrap:admin
npm run dev
```
