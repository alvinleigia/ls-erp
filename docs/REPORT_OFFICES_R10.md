# R10 phase 2D7A: booking-source coupon reporting

Implemented locally on `staging`. This slice does not release office controls or
complete the composed audit report review. No migration or historical data rewrite
is required for this report change.

## Population and totals

The coupon report includes only customers with at least one readable,
non-canceled saved `AppointmentOrder` in the requested office/date scope.
Directory-only customers, canceled-only bookings and customers with bookings only
in inaccessible offices are excluded from both views and every total.

- With matching coupon use: a booking in that population has any coupon, or the
  selected normalized code.
- No matching coupon use: none of that customer's readable bookings in the
  selected scope/period has the matching coupon. This is not a global claim that
  the customer has never used a coupon.
- Customers in report: distinct customers in the source population, after search
  and office/date filtering; independent of the selected code/status.
- Coupon redemptions: matching coupon application rows, not distinct bookings.
  Two saved codes on one booking count as two applications.
- Row usage/count/code/latest fields use exactly the same source/code predicates.
  The latest timestamp is the matching booking's creation timestamp.
- Search applies to source-population customer name/email/phone. Paging orders
  customers by creation timestamp descending and ID ascending for stable ties.

Dates refer to **booking creation**, not the visit date. Boundaries use the
current tenant time zone: inclusive local start and exclusive next-local-day end,
including daylight-saving transitions. The client formats dates/times using the
returned tenant settings even if the browser uses another zone. Invalid calendar
dates, reversed periods and oversized requests return 400.

## Authorization and office scope

`modules/appointments/coupon-report.ts` owns the query. The thin route requires
Appointments and Coupon Read plus the active Appointments module. The service
re-resolves these permissions and the active account after acquiring a shared
transaction lock, using the same key as native source/security writers. This
prevents a waiting report from accepting a pre-revocation permission snapshot and
keeps its rows/counts coherent with those writers. Read Committed is deliberate:
resolve permissions only after the lock, not in an older snapshot.

Native booking/financial-child RLS remains authoritative. No generic customer
or staff directory permission is delegated. The report makes no business writes.
It uses the same bounded booking-office choice/label adapter as booking screens.
An optional `officeId` narrows existing source Read, never expands it. Unknown,
foreign or inaccessible explicit offices return the same 403. Closed offices
retain authorized historical Read. No office filter means all readable booking
offices; the creation-workspace preference does not constrain or expand reports.

The UI describes that scope, clears prior rows/totals/context on loading/error,
and aborts obsolete requests. It never displays an empty result as proof that all
customers have used coupons. The status wire keys remain `used` and `not_used`.

## Verification

Run `npm.cmd run test:coupon-report` against its disposable Docker database.
The application role is non-owner/non-superuser with native RLS. The suite covers
hidden/overlapping offices, mixed visible/hidden coupon histories, unbooked and
canceled customers, cohort totals/paging/search/code counts, tenant-midnight/DST
boundaries, closed offices, revocation, both required permissions, forged actor
grants, post-lock reauthorization, validation and unchanged saved bookings/audits.

After `npm.cmd run build`, run `npm.cmd run test:coupon-report:browser` for real
synthetic tenant sign-in, readable/no-match views, tenant formatting with a
different browser zone, explicit closed-office narrowing, desktop/mobile filters
and clearing sensitive results after office revocation. Inspect its screenshots.
The existing Inventory/booking regression suite remains independently required.
No hosted database or client login is used by either runner.

Verified locally on 2026-10-27: nine report integration checks, 85 existing
Inventory/booking regression checks and one real-sign-in Chrome flow (desktop,
mobile, closed-office filtering and revoked-office recovery) passed, with no
skipped checks counted. The 129-migration disposable rehearsal also passed,
including all 18 Inventory native/preservation checks. Desktop/mobile/filter
screenshots were inspected. Production build, TypeScript, changed-file ESLint
and whitespace checks passed. Evidence logs are retained locally under
`tmp/industry-release`; screenshots are under `test-results/local-access`.

## Remaining phase 2D7 work

Phase 2D7B now adds the closed composed audit family registry and report review
(`AUDIT_REPORTS_R10.md`), with the source inventory in `RESOURCE_BOUNDARIES_R10.md`.
The exhaustive cross-module executable ownership registry, user/workspace UI and
collaborator release work remain later gates. Completing
this coupon report is not evidence that every report or workspace control is ready.
