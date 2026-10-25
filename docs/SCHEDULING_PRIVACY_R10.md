# R10 phases 2D1-2D2: private scheduling integrity

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

## Phase 2D2: hidden booking conflicts

`modules/appointments/booking-integrity.ts` adds two shared integrity projections:

- Conflict summaries return an input slot index, staff/customer conflict flags and
  the staff conflict count. No appointment, customer or service identifiers or
  details are returned. Appointment creation, edits, bulk moves, booking-order
  suggestions, leave approval and flexible-plan previews use this summary.
- Active staff booking pages return only supplied staff IDs and busy intervals.
  Plan guards and scheduling-mode changes use them even when Appointments is
  disabled or the source appointment is hidden. Staff selections and intervals
  both page in batches of 200, using stable keyset cursors. There is no fixed
  future cutoff; overdue in-progress work is included. Duplicate identical busy
  intervals collapse to one plan conflict, not a count of hidden source records.

Current actor/tenant status, profiles, Read limits and activation are checked on
every projection. Appointments or Shifts Read permits its scheduling integrity
checks; leave approval workflows can check staff conflicts through Leaves Read.
Customer probes and exclusions additionally require Appointments Read. A role
label alone grants nothing. Business endpoints still authorize the action and
affected staff/request scope; this is not a directory or an assignment grant.

An edit exclusion must come from appointments already resolved through ordinary
record access. API availability rejects hidden exclusion IDs; bulk moves reject
invisible targets. The SQL helper also rejects missing/foreign exclusion IDs.
Exclusions never authorize a write. Internal order scheduling retains its final
locked collision check after advisory suggestions.

Leave conflict details are not queried when Appointments Read is unavailable.
Roster conflict resolution fetches details after rollback through ordinary RLS;
the integrity projection never supplies a source ID. Hidden bookings can block a
change while the list of appointments the user may resolve remains empty.
Existing shared scheduling locks, action authorization and atomic audit/history
writes remain in place. No UI changes or broader business grants are introduced.

## Migration and release boundary

Migration 116, `20261026000500_private_workforce_availability`, adds only the
projection function. Rollback rehearsal and exact comparison preserve every row
in all 125 preceding tables: no leave, booking, history, owner, profile, permission
or office grant is rewritten. No runtime fallback is added.

Migration 117, `20261026000600_private_booking_integrity`, adds the booking
projections and their fresh authority check. It changes no table, policy or row.
Its rollback rehearsal also compares all 125 preceding tables exactly.

Next steps are native operational office ownership, personal/history rules and
stock boundaries. Do not deploy this foundation
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

Phase 2D1 verification: all 163 regression checks passed, followed by the Chrome flow
above. Production build, TypeScript, targeted lint and whitespace checks passed.
Evidence: `tmp/industry-release/ls-erp-sales-orders-8585533a1042.log` (regressions)
and `tmp/industry-release/ls-erp-sales-orders-6ddd6c62dd34.log` (Chrome and migration
rehearsal). These ignored reports contain synthetic local test data only.

The phase 2D2 regression suite also deliberately hides appointment rows through a
restrictive test policy. It covers staff and customer collisions, half-open time
boundaries, edit/bulk/order paths, hidden edit exclusions, leave approval with
Appointments disabled, plan rollback, overdue in-progress work, paging beyond 200
busy intervals, current profiles/rules/modules, suspension, foreign inputs and
non-UTC database sessions. A shared-interval case verifies that all 201 visible
resolution records are retrieved in bounded pages after rollback.

The Chrome flow creates a real booking, hides it through a local-only test policy,
confirms detail denial, blocks a duplicate booking and rejects an incompatible
plan edit without returning the hidden appointment. Persisted working time is
checked after rollback. All fixtures and policies are confined to the disposable
local database; hosted databases and saved client sessions are untouched.

Phase 2D2 verification: all 176 checks passed with no skips, followed by the real
Chrome flow against the final production build. Build, TypeScript, changed-file
lint and whitespace checks passed. Migration 117 rollback and exact preservation
of all 125 preceding tables passed. Evidence:
`tmp/industry-release/ls-erp-sales-orders-51bebea7a8c3.log`.
No push, hosted migration or deployment is included.
