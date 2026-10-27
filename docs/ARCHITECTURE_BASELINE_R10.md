# R10 phase 5: architecture baseline cleanup

The three architecture checks reported during phase 4C2b now pass unchanged.
This is local cleanup on `staging`, with no schema/data migration, permission
backfill, compatibility export or hosted operation.

## Boundaries restored

Generic inventory corrections remain in `modules/inventory/stock-service.ts`.
The source-specific native booking command is now in `booking-stock.ts`, called
by the appointment coordinator. Both use `stock-authority.ts` for the existing
tenant check, action grant, shared operation lock and fresh post-lock authority.
The operation bodies and protected native postings retain their original behavior:
saved sources derive quantities and offices; callers cannot supply stock totals.

Calendar-only conversion/offset helpers now live in `lib/business-time.ts`.
Audit, coupon reports, dashboard composition and the sample-data utility import
that shared implementation directly. The duplicate sample helper and dashboard
exports were removed rather than retained as aliases. Audit code no longer imports
an application implementation. Inclusive end dates still convert the next tenant
calendar date to its first instant, including 23/25-hour days and skipped dates.

Inventory office-choice validation/querying now belongs to
`modules/inventory/office-choices.ts`. The HTTP route authenticates and forwards
input; the same native office-choice projection still controls search, selected
labels, count and paging under current inventory Read and module activation.
The complete route scan also exposed the shifts staff-choice adapter. Its existing
module check and input validation now live in the workforce service, retaining
the post-lock authority refresh and native staff-choice projection.

No assertion was removed, relaxed or bypassed. No role fallback, caller-provided
source scope or alternate authorization path was added.

## Verification

`npm.cmd run test:architecture-baseline` runs the original architecture checks,
calendar-boundary cases, native inventory/appointment/workforce/audit/coupon
checks and the phase 4 reporting regressions in an isolated PostgreSQL database.
`npm.cmd run test:architecture-baseline:browser` adds real Chrome after a build.
All historical office/booking/daily compatibility fixture paths remain disabled.

The original 23 architecture checks pass. Calendar cases cover host-independent
leap/year boundaries, New York DST, a fractional-offset zone and a skipped Apia
date. A new HTTP booking case verifies stock 10 -> 8 -> 10 on confirmation and
cancellation, with no duplicate movement when cancellation is replayed. Existing
tests continue to exercise native office/version, source privacy, current grants,
transaction rollback, receipts and record/selector scope boundaries.

Verified locally on 2026-10-28:

- **169 checks pass together with zero skips**. A focused **17-case booking run**
  also passes, including the new stock-posting case added after the combined run:
  **170 distinct service/architecture/calendar checks** across the two runs.
- **10 real-Chrome flows pass together**, covering inventory corrections/receipts,
  saved office/stale drafts, booking ownership, staff-choice paging/retention,
  audit privacy, coupon tenant dates and dashboard attribution/revocation.
  Inventory and audit/coupon captures were inspected.
- All **132 migration rehearsals** and **18 native stock preservation checks**
  pass. Build, TypeScript, changed-source ESLint and whitespace checks pass.
- The original architecture test file is unchanged. No failing assertion was
  turned into a skip or exception.

Ignored evidence under `tmp/industry-release`: `phase5-architecture.log`,
`phase5-rehearsal.log`, `phase5-api.log`, `phase5-booking-stock.log`,
`phase5-build.log`, `phase5-browser.log`, `phase5-lint.log` and `phase5-tsc.log`.
Screenshots remain under `test-results/local-access`.

## Release boundary

This closes the local architecture findings from phase 4C2b. It does not certify
a restored pilot database or a hosted release. Fresh encrypted backup/restore
verification, copied-data migration rehearsal, stable record/owner/effective-access
comparison and hosted staging acceptance remain before production release.
No client records or hosted browser sessions were touched.
