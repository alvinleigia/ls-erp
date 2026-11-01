# Persistent local demo and database migrations

The local demo uses its own PostgreSQL 17 Docker volume. It does not connect to
either Supabase project and never copies client data. Docker Desktop and installed
project dependencies are required. Ports 55445 (database) and 3109 (app) must be free.

## Start and sign in

Run from the project directory:

```powershell
npm.cmd run local:demo
```

The command creates local credentials if needed, starts PostgreSQL, checks immutable
migration history, applies pending committed migrations, generates Prisma Client, starts the real application
and provisions sample data once through its normal APIs. Subsequent starts preserve
records, edits, passwords, access profiles and assignments. Schema migrations still
run when new committed migrations are added. There is no automatic database reset.

Open `http://demo.localhost:3109/crm/sales?view=team`.

| Login | Example access |
| --- | --- |
| `admin@demo.test` | Tenant administrator |
| `manager@demo.test` | North Sales manager |
| `regional@demo.test` | Manager of North and South Sales |
| `staff1@demo.test` | Alex; own sales records |
| `staff2@demo.test` | Blair; own sales records |
| `staff3@demo.test` | Casey; own sales records |
| `staff4@demo.test` | Drew; member with no initial work |

Passwords are the generated `DEMO_PASSWORD` in ignored `.env.local-demo`; credentials
are never committed or printed. A separate isolation business is available at
`http://isolation.localhost:3109` as `admin@isolation.test`. The local platform console
is `http://platform.localhost:3109`, login `platform@local-demo.test`.

The initial dataset includes two businesses, two sales teams, two managers, four
staff, 40 enquiries covering all current statuses, nine conversions, twelve
opportunities across open/won/lost stages, and 36 activities including completed
calls and pending follow-ups. INR and USD values remain separate. Initial sample
dates follow the demo business timezone at creation; choose a report period
covering creation when reviewing the demo later.

All business modules are initially enabled. The prepopulated business data focuses
on generic CRM and team reporting; other modules can be tested with new local
records. Hosted email and Supabase Storage credentials are deliberately absent.
Storage/provider-dependent workflows continue to use isolated staging checks;
local startup must never borrow production service credentials.

`Ctrl+C` stops the application; the database and its named volume remain. To stop
PostgreSQL without deleting data, use `npm.cmd run local:stop-db`. Keep
`.env.local-demo` with the volume: it contains the passwords required to reopen it.
If the credential file is missing while the volume exists, startup stops instead
of replacing credentials or deleting data. Interrupted/uncertain seed requests
also stop for explicit review instead of retrying business writes blindly.

The local app uses `tmp/local-demo/next` and an isolated TypeScript configuration,
so it does not overwrite the optimized `.next` build used by workflow tests.

## Migration workflow

Migration SQL is committed once in `prisma/migrations` and promoted unchanged from
local development to staging and then main. Each database records its own applied
history. No staging or production fixture seeding is performed by this workflow.

| Target | What happens automatically |
| --- | --- |
| Local demo startup/setup | Apply pending committed migrations, then verify history |
| Registered staging Vercel project, `staging` branch, Production target | Apply pending migrations before generating/building the application |
| Registered production Vercel project, `main` branch, Production target | Verify history; fail the build if a migration still requires the controlled production release |
| Preview, mismatched project/branch/database | Refuse hosted migration execution |

Local production builds outside Vercel skip the hosted hook. Hosted checks validate
both runtime and migration URLs against the registered Supabase project reference.
Migrations require a direct/session connection on port 5432, using
`MIGRATION_DATABASE_URL` when set, otherwise `DIRECT_URL`. That server secret must
have migration/DDL privileges; it must never be a public environment variable.
`DATABASE_URL` remains the ordinary restricted runtime connection.

History checks reject unfinished migrations, edited SQL, missing migration files,
duplicate successes and gaps before already-applied migrations. Windows/Linux line
ending variants are accepted without accepting SQL changes. Prisma's migration
advisory lock coordinates concurrent deployment attempts; failures stop the build.
There is no automatic baselining, resolve-as-applied or destructive reset.

For a new schema change:

```powershell
npm.cmd run local:migration -- add_customer_reference
# Review the generated SQL and commit it with the matching application change.
npm.cmd run local:migrate
npm.cmd run local:verify
```

Migration generation is an explicit developer action against the guarded local
database. SQL is not generated automatically during hosted builds. Existing
sample records are not recreated or rewritten when applying migrations.

Production still follows the agreed release process: reviewed migrations, recovery
rehearsal/verified backup, required maintenance, migration application, matching
application deployment and verification before reopening. The production build
guard enforces that sequencing; merging code alone never applies production SQL.

## Verification commands

```powershell
npm.cmd run local:setup
npm.cmd run local:info
npm.cmd run local:verify
npm.cmd run test:database-workflow
npm.cmd run db:check -- local
npm.cmd run db:check -- staging
npm.cmd run db:check -- production
```

`db:check` is read-only and uses the explicitly selected environment file. It never
applies migrations. `local:verify` authenticates actual local accounts and verifies
counts, team boundaries, a multi-team manager, staff/cross-tenant denial, unscoped
runtime RLS, chart rendering, mobile containment and repeat-seed preservation.
It uses no saved hosted browser state and writes no business changes. These known
initial counts are intended for a fresh demo; deliberate manual edits can change
the expected counts. Private receipts/screenshots live in `tmp/local-demo`.

The existing disposable `test:*` workflow databases remain separate from this
persistent demo. Do not point their reset/fixture helpers at the demo or hosted DBs.
