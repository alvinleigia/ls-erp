# Supabase Setup

This project works well with Supabase because it is a standard PostgreSQL app.

Important for this codebase:
- keep Prisma
- keep our existing Postgres row-level security (RLS)
- use Supabase transaction pooling (`6543`) for serverless app traffic
- do not give the main app role `BYPASSRLS`

## Why

The app sets transaction-local tenant DB context through `lib/tenant-pg-adapter.ts`:
- `app.tenant_id`
- `app.rls_bypass`

Those settings are then used by the policies created in `prisma/migrations/20260623160000_enable_tenant_rls/migration.sql`.

Both settings are applied inside the same transaction as the queries and are
cleared at commit/rollback. Standalone Prisma queries receive a short transaction;
interactive and batch transactions retain one scope for their full lifetime.
Base, tenant and platform clients share one bounded `pg` pool per server instance.
This replaces the old per-tenant session pools that exhausted Supabase's session
connection limit when Vercel scaled or suspended instances.

## Recommended connection pattern

Configure runtime and migration connections separately:

1. `DATABASE_URL`
Transaction pooler on port `6543`

Use this for the running app. For existing deployments, the runtime automatically
maps a shared Supabase pooler URL on `5432` to the same hostname/credentials on
`6543`. Direct PostgreSQL and local URLs are unchanged. The original environment
variable is not modified, so Prisma CLI/scripts keep their existing connection.

2. `DIRECT_URL`
Direct connection or session pooler on port `5432`

Use this optionally for Prisma CLI and migrations. The repo is configured so Prisma CLI will prefer `DIRECT_URL` when present, otherwise it falls back to `DATABASE_URL`.

When `DATABASE_URL` already uses `6543`, provide a direct/session `DIRECT_URL`
for migrations. Never use persistent session `SET` for tenant context in runtime
code: transaction pooling can choose a different backend after each commit.

## Supabase dashboard steps

1. Create a new Supabase project.
2. Open `Connect` in the project dashboard.
3. Copy:
   - the `Transaction pooler` connection string ending in `:6543` for runtime
   - a `Direct connection` or `Session pooler` string ending in `:5432` for migrations
4. Open `SQL Editor`.
5. Run the SQL below to create the app role.

## SQL to create the app role

Replace `YOUR_STRONG_PASSWORD` first.

```sql
create user prisma_app
with password 'YOUR_STRONG_PASSWORD'
createdb;

grant usage on schema public to prisma_app;
grant create on schema public to prisma_app;

grant all on all tables in schema public to prisma_app;
grant all on all routines in schema public to prisma_app;
grant all on all sequences in schema public to prisma_app;

alter default privileges for role postgres in schema public
grant all on tables to prisma_app;

alter default privileges for role postgres in schema public
grant all on routines to prisma_app;

alter default privileges for role postgres in schema public
grant all on sequences to prisma_app;
```

Notes:
- This intentionally does **not** include `bypassrls`.
- `createdb` is useful for `prisma migrate dev` because Prisma may need a shadow database during development.

## Env values for this repo

Set these in `.env`:

```env
# App runtime: use Supabase transaction pooler on 6543
DATABASE_URL="postgres://prisma_app.[PROJECT-REF]:YOUR_STRONG_PASSWORD@aws-[REGION].pooler.supabase.com:6543/postgres"

# Optional: use direct connection for Prisma CLI/migrations when available
DIRECT_URL="postgresql://prisma_app:YOUR_STRONG_PASSWORD@db.[PROJECT-REF].supabase.co:5432/postgres"

AUTH_SECRET="replace-with-a-long-random-secret"
APP_ROOT_DOMAIN="localhost"
PLATFORM_ADMIN_TENANT_SLUG="platform"
PLATFORM_ADMIN_TENANT_NAME="Platform Tenant"
PLATFORM_ADMIN_NAME="Platform Admin"
PLATFORM_ADMIN_EMAIL="platform-admin@ls-salon.test"
PLATFORM_ADMIN_PASSWORD="password123"
```

If direct IPv6 access is unavailable, use the session pooler (`5432`) for `DIRECT_URL`.

## Local commands after env setup

Run:

```bash
npm run db:migrate
npm run bootstrap:admin
npm run dev
```

## Local hostnames

With `APP_ROOT_DOMAIN=localhost`:
- platform tenant: `http://localhost:3000`
- tenant example: `http://storefront1.localhost:3000`

## Troubleshooting

If migrations fail:
- confirm Prisma CLI's `DIRECT_URL` uses direct/session port `5432`
- confirm the password belongs to `prisma_app`, not the default `postgres` user
- if the direct host is unreachable, use the session pooler for `DIRECT_URL`
- make sure the custom role SQL was executed before running Prisma
