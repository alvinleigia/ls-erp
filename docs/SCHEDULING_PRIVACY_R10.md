# R10 phase 2D1: private availability foundation

Local implementation on `staging`. This is a prerequisite for operational office
ownership, not the completed workforce/bookings/purchasing office boundary.
No hosted migration, deployment or client-data change is included.

## Integrity and privacy

An approved leave remains a booking conflict even when the requester cannot read
the leave record or Leaves is disabled. Availability returns only "Staff member
is unavailable on this date." It does not disclose the reason, classification,
leave-definition code or request identifier.

`modules/workforce/availability-blocks.ts` provides the shared batch projection
used by appointment availability/create/edit/order scheduling through the working-
time helper and by shift-plan booking protection. It returns staff profile IDs
already supplied by the caller and unavailable date ranges clipped to the caller's
window. Duplicate projected ranges are deduplicated. Source requests, their
reasons and saved roster/history content are unchanged.

The database helper is tenant-bound, uses the current transaction actor, and
rechecks account/tenant status, profiles, read limits and source-module activation.
Ordinary users need current Read access to Appointments or one of the scheduling
resources; a Manager label alone grants nothing. Tenant Admin retains its existing
administrative oversight. It grants neither assignment eligibility, business
actions, leave approval authority nor permission to read the hidden source.

This is a narrow, unexposed `app`-schema integrity projection. Its database owner
can read hidden source rows; the application does not enable RLS bypass. The
function returns no record IDs, reasons, names or classifications. Missing actors,
suspended accounts, foreign tenants and mixed invalid staff lists fail closed.
The service cannot interpret an authorization failure as an empty busy calendar.

Queries accept at most 200 distinct staff, matching the existing plan-protection
page size. Plan checks retain their existing shared scheduling lock and bounded
queries. There is no new fixed future horizon; far-future existing bookings still
need protection. Date-only parameters preserve the requested dates independently
of the database connection's time zone.

## Migration and release boundary

Migration 116, `20261026000500_private_workforce_availability`, adds only the
projection function. Rollback rehearsal and exact comparison preserve every row
in all 125 preceding tables: no leave, booking, history, owner, profile, permission
or office grant is rewritten. No runtime fallback is added.

Next steps are native operational office ownership, remaining private conflict
paths, personal/history rules and stock boundaries. Do not deploy this foundation
as if those office boundaries were complete. Office controls, selectors, backup
rehearsal and hosted staging verification remain prerequisites for the full R10
release; production requires a separately authorized release.

## Verification

`npm.cmd run test:availability-boundary` uses a guarded disposable local PostgreSQL
database with a nonprivileged runtime role. It covers a deliberately hidden leave
source, generic booking errors, no writes on a conflict, clipped/deduplicated data,
current permissions, module activation, revocation, foreign staff, batch/range
bounds, long horizons, connection time zones and pooled-context isolation. The
existing workforce and appointments integration suites and workforce unit checks
run alongside it. Direct availability fixtures now name their test administrator
explicitly; runtime calls never invent an actor.

After building, `npm.cmd run test:availability-boundary:browser` uses real Chrome
sign-ins. A local-only restrictive test policy hides a leave row; the browser
checks source denial, disables Leaves, verifies booking denial without private
details, creates a booking on a free day, and verifies fresh suspension denial.
This is an authenticated API/workflow check, not visual verification of new UI.

Verified locally: all 163 regression checks passed, followed by the Chrome flow
above. Production build, TypeScript, targeted lint and whitespace checks passed.
Evidence: `tmp/industry-release/ls-erp-sales-orders-8585533a1042.log` (regressions)
and `tmp/industry-release/ls-erp-sales-orders-6ddd6c62dd34.log` (Chrome and migration
rehearsal). These ignored reports contain synthetic local test data only.
