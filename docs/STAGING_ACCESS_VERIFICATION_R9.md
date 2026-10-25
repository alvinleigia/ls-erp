# R9 hosted staging verification — 2026-10-25

Application commit: `c2d0a9ead70c01d2bdb0cffa015511955414662e`.
Staging deployment: `dpl_7gLWS7iJUXW4bPrRAbKhxZWTRjYi`.
Target: `https://ls-erp-staging.vercel.app`, Vercel project `ls-erp-staging`.
Database: Supabase staging project `oyhsrcmjhwxhvepdbcdc`, migrations 1–111.

The application was deployed directly from an isolated archive of the local
staging commit. GitHub branches were not pushed. Vercel's Production environment
inside the separate staging project serves this staging URL; the customer-facing
`ls-erp` project and `erp.ewissen.in` deployment were unchanged.

## Cutover and preservation

An encrypted application-schema backup was taken before cutover and restored to
an isolated PostgreSQL container. All four pending migrations were rehearsed on
that restored staging data before applying them to staging. Backup ID
`e492039d5500` is retained privately under `tmp/r9-staging`; its encryption key
is wrapped with Windows CurrentUser DPAPI. No credentials or backup contents
are committed.

The restore comparison checked data, identities, schema, constraints and policies.
Metadata lists were sorted independently of server collation. Differing CHECK
parentheses were reparsed through the target PostgreSQL parser and compared;
constraints were not omitted from verification.

Staging access was temporarily suspended for the schema/code cutover, then its
original tenant statuses were restored after the matching deployment was ready.
Migration checks verified:

- 112 prior tables preserved, accounting only for renamed teams and new null
  columns; record IDs, ownership, project/team membership and financial data stayed
  intact.
- The four intentionally transformed tables retained their reviewed profile,
  assignment, approval-route and custom-field translations.
- New sharing policies/grants were empty. Existing records stayed Normal.
- New security tables retained forced RLS and the restricted runtime role's
  required table privileges.
- Four existing QA accounts had exactly the same visible enquiry, opportunity and
  project IDs immediately before and after migration, before new test writes.

The three original staging aliases were checked against the new deployment.
Production's alias deployment ID was checked before and after the operation.

## Results

**40 distinct hosted scenarios passed across the verification runs**, plus
**26 page/mobile navigation checks**. Retries and repeated regressions are not
added to the distinct-scenario total. The suite combines 34 staging access/workflow
scenarios and six existing hosted financial scenarios.

| Area | Verified behavior |
| --- | --- |
| Provisioning and lifecycle | Fresh tenants created through the platform API; module allowances; suspension/reactivation; existing data retained |
| Profiles and roles | Explicit module profiles, profile composition, independent record rules, missing actions and None caps, administrative boundaries |
| Record sharing | Normal/Restricted modes; selected users/teams; Read/Edit levels; grant union; membership removal; live revocation; stale saves |
| Privacy and isolation | Tenant boundaries in APIs and runtime RLS; private source contacts/projects/quotations; protected lists, exports and dashboard data |
| Teams and projects | Teams without CRM; team managers; team report selection/drill-down; staff project access; subproject inheritance |
| CRM | Enquiry conversion, structured loss reasons, opportunities, site visits, history and follow-ups, sales reporting |
| Import and configuration | CSV template, mapping, validation, duplicate/error correction download and re-upload; custom fields and industry terminology |
| Sales and finance | Frozen quotations, order transitions, receivables, currency totals, payments/reversals, reservations, expiry, collection follow-ups |
| Financial sharing | Private sources protect orders and their children; Read sharing cannot collect; Edit sharing remains profile-bound; hidden orders still reserve their units |
| Inventory and services | Service/category setup, products/suppliers/purchases, idempotent receiving, confirmed-booking stock consumption and cancellation restoration |
| Bookings and workforce | Availability/conflicts, coupons/pricing, saved record identity, invoice rendering, leave eligibility/review/audit, conflict rescheduling, weekly/recurring plans |
| Branding and PDFs | Tenant-isolated logo upload, optimized images at or below 512 KiB, transient draft preview, immutable issued bytes and revision isolation |
| UI | Representative desktop/mobile sharing, profile assignment, import, branding, financial and workforce screenshots inspected; mobile overflow checks |

The final navigation run recorded no unhandled page errors or server failures.
The pricing-retry scenario deliberately injected one HTTP 503 response to verify
that stale prices cannot be saved and retry restores the current server price.
That injected response is recorded separately from application failures.

TypeScript, changed-source ESLint, the production build and Git whitespace checks
passed.

A separate read-only database probe confirmed that `prisma_app` has no superuser,
BYPASSRLS, role-creation or database-creation authority. Both original QA tenants
contained users and the first contained enquiries: own-tenant reads succeeded,
while reads of those populated foreign sources returned zero in both directions.

## Issue found and fixed

An administrator visiting `/leaves/requests` started employee-only personal-leave
requests before redirecting to approvals, producing unnecessary 400/401 responses.
Personal data loads now wait for an eligible Staff/Manager session. The fix keeps
the existing administrator redirect and backend personal eligibility rules.

After deploying the fix, the admin navigation regression passed with no personal
requests, Staff personal access remained available, and all eight booking/workforce
workflow regressions passed again. The private-financial-record scenario also ran
against this final deployment.

Older hosted financial tests were updated to assign explicit QA profiles to newly
created staff accounts. Their prior implicit-role setup correctly received access
denials under R9. A lifecycle cleanup assertion was corrected to accept the API's
documented 409 for an already-active tenant. Application authorization was not
relaxed to satisfy these tests.

## Test scope and cleanup

The new suite creates fresh `QA R9` tenants and temporary staging hostnames through
public platform/Vercel APIs. It never runs local seed, fixture or reset scripts
against the hosted database. Its optional database checks use a tenant-scoped,
read-only transaction with the non-bypass runtime role.

All **42 temporary QA tenants** were archived after verification and their
temporary Vercel domains/aliases removed. The four original tenant statuses and
three original staging aliases were verified unchanged. Immutable test history is retained under those archived
tenants. The existing two named QA tenants retain their financial-test records;
no global tenant reset or hosted hard-delete was used.

Private receipts, the consolidated scenario list, screenshots and cleanup results
are under `tmp/r9-staging`. Existing hosted financial screenshots are under
`test-results/staging-orders`. These paths are Git-ignored. Passwords, browser
sessions and deployment tokens are never included in the report or commits.

For a future run, first verify the current staging target and refresh the private
deployment/reopened receipts. The hosted fixture refuses a different Supabase
project, a different Vercel project, a stale primary staging alias, arbitrary tenant
hosts or a missing explicit opt-in.

```powershell
$env:RUN_STAGING_ACCESS_WRITES = '1'
npx playwright test --config playwright.staging-access.config.ts

$env:RUN_STAGING_ORDER_WRITES = '1'
npx playwright test --config playwright.staging-orders.config.ts
```

These are functional, access-boundary and migration-preservation checks. Nested
team trees and per-record sharing for operational scheduling/purchasing remain
outside this release, as described in [the sharing contract](RECORD_SHARING_R9.md).
Production deployment is a separate release step.
