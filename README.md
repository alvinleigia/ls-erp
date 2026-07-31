# LS Salon

Multi-tenant salon SaaS built with Next.js, Prisma, Postgres, and tenant-scoped host routing.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file from `.env.example`:

```bash
cp .env.example .env.local
```

Recommended local values:
- `DATABASE_URL` should point to a local Postgres database you create first.
- `APP_ROOT_DOMAIN=localhost` enables generated links such as `tenant-slug.localhost:3000`.
- `PLATFORM_ADMIN_*` values control the bootstrap tenant and first admin login.

For Supabase instead of local Postgres:
- use the `Session pooler` connection string on port `5432` for `DATABASE_URL`
- optionally use the `Direct connection` string on port `5432` for `DIRECT_URL`
- do not use the transaction pooler on port `6543` for normal app runtime
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
- `VERCEL_API_TOKEN` to automatically add tenant custom domains to the Vercel project
- `VERCEL_PROJECT_ID` or `VERCEL_PROJECT_NAME` for the Vercel project that serves tenant domains
- `VERCEL_TEAM_ID` when the Vercel project belongs to a team account

For local development, put these values in `.env.local` after copying `.env.example`. For the deployed app, add the same variables in Vercel under Project Settings > Environment Variables for the Production environment.

## Tenant custom domains on Vercel

When `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID`/`VERCEL_PROJECT_NAME` are configured, tenant creation and tenant-domain edits automatically add the custom hostname to the Vercel project before saving it in the database. This removes the manual Vercel dashboard step.

Where to configure the Vercel integration values:
- Local development: copy `.env.example` to `.env.local`, then set `VERCEL_API_TOKEN` plus either `VERCEL_PROJECT_ID` or `VERCEL_PROJECT_NAME`. Use `VERCEL_TEAM_ID` only if the project is owned by a Vercel team.
- Production: add the same variables in the Vercel project dashboard under Project Settings > Environment Variables. Redeploy after changing them.

Clients still need to point DNS at Vercel:
- Subdomains such as `booking.client.com`: create a `CNAME` record for `booking` pointing to `cname.vercel-dns.com`.
- Apex/root domains such as `client.com`: use Vercel's apex-domain setup, typically an `A` record for `@` pointing to `76.76.21.21`.

## Notes for this repo

- Multi-tenant conventions live in `docs/CONVENTIONS.md`.
- Prisma schema lives in `prisma/schema.prisma`.
- Tenant-safe Prisma context is handled in `lib/prisma.ts`.
- Platform provisioning APIs intentionally use a tightly scoped RLS bypass path.
- Supabase setup notes live in `docs/SUPABASE_SETUP.md`.

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
