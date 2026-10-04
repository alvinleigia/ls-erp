# ERP release readiness

Reviewed 2026-10-04. Local verification is complete for the implemented Phase 2
interface, Phase 3 access controls and Phase 4 workflow scope. Hosted rollout and
hosted verification are pending. The user has requested no push or deployment.

## Release contents

- `6fa8fd8`: ERP identity and shared interface components.
- `871f4fb`: operational module views, module activation, action permissions,
  CRM record scopes, audit review and six migrations.
- Phase 4 release checkpoint: suspended/wrong-tenant
  session recovery; booking PATCH preservation of products/coupons; tenant-aware
  Leaves dates and appointment conflict rescheduling; isolated workflow tests.

There are no further schema changes after the Phase 3 checkpoint. Package and
lockfile both identify `ls-erp` and their dependency declarations match. The local
folder remains `C:/xampp/htdocs/ls-salon`; it is not a release dependency.

## Verification evidence

| Check | Result |
| --- | --- |
| Production build including Prisma generation and TypeScript | Passed on the final application changes |
| Root ESLint, rerun at this review | Zero errors, four existing warnings |
| Read-only deployment checks, rerun at this review | 9 passed against local PostgreSQL using the non-bypass runtime role |
| Local migration history | 96 applied; release migration checksums, scope constraints and audit indexes verified |
| Real local browser/API workflows | 20 scenarios passed across the full run and focused ERP rerun: 10 access, 5 sales, 5 ERP |
| Date/history unit checks | 6 passed, including DST ambiguity and browser/tenant timezone differences |
| Appointment/workforce integration checks after timezone change | 17 passed |
| Booking/inventory integration checks after PATCH fix | 20 passed |
| Whitespace, environment/session/report exclusions, package/lockfile consistency | Passed |

The full browser run originally had one new test timing/capture failure; the
corrected test waits for approval and reads persisted state through the API.
All five ERP scenarios then passed on the final application build. This is not
a claim of a single clean 20-test run. Relevant screenshots were inspected.
Earlier Phase 3 migration rehearsal and broad UI/API results remain documented
in [ERP_STANDARDIZATION.md](ERP_STANDARDIZATION.md).

Most setup mutations use authenticated APIs. The tests do not certify every form,
all PDF layouts, email delivery, or the hosted environment. Four historical
upgrade-fixture cases remain unverified because their optional fixtures were not
supplied. Existing lint warnings are in tenant settings, the tenant API, the
root landing page and the weekly overrides editor.

## Migration order

These six migrations are in the unpublished release relative to the local
`origin/main` reference. The target's actual migration history must be checked
before rollout; it was not accessed during this review.

1. `20261003090000_inventory_module`
2. `20261003100000_services_module`
3. `20261004090000_appointments_module`
4. `20261004100000_workforce_modules`
5. `20261004110000_crm_record_scopes`
6. `20261004120000_audit_review_indexes`

The module migrations preserve explicit activation decisions and fill missing
legacy flags. Record scopes default to ACCOUNT_ROLE; existing team members are
not automatically managers. Audit indexes do not rewrite history. The schema
must be upgraded before code that selects the new scope columns goes live.

## Rollout when requested

1. Verify the final local commit includes application changes, shared helpers,
   tests, documentation and all six migration directories. Exclude `.env*`,
   `.playwright-auth`, `.vercel`, `tmp` and generated reports.
2. Verify the intended Vercel project ID, Git connection, environment and tenant
   domains. Do not infer the target from the old local Vercel display name.
   Verify runtime and direct database connections without printing their values.
3. Confirm backup/recovery availability. Run `npm.cmd run db:status` with the
   intended direct connection, then `npm.cmd run db:deploy` for pending migrations.
   Do not use `db:migrate`, `db:reset` or local fixture scripts on the hosted DB.
4. Run `npm.cmd run test:crm:migration` with explicit
   `CRM_VERIFY_CONFIGURED_DATABASE=1` and the intended runtime `DATABASE_URL`.
   Verify the runtime role has no RLS bypass.
5. Only then push/deploy the reviewed commit. A push to a Vercel-connected main
   branch may trigger deployment, so migration readiness must precede that push.
6. Follow [BROWSER_TESTING.md](BROWSER_TESTING.md) for saved-session hosted checks:
   admin/staff login; module enable/disable and retained data; role and team scope;
   cross-tenant denial; audit redaction; enquiry through quotation/payment plan
   and won/lost; booking stock totals; leave approval and tenant-time rescheduling.
   Inspect relevant screenshots and build/runtime logs before declaring rollout complete.

Historical plaintext login notes were removed from the current tree in Phase 3,
but remain in Git history. Their rotation status is not verified; any still-valid
credentials from those notes need rotation before release. No accounts were
changed during this review.

## Recovery

The six migrations are additive. Preserve the schema and data when reverting an
application deployment; do not automatically drop access columns or audit indexes.
Older code may not enforce newly configured access rules, so review access impact
before restoring it. Prefer a corrective release when a rollback would weaken
tenant restrictions. Local verification never replaces the hosted rollout checks.
