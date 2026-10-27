# R10 phase 2D4A: dated staff workplaces

Local implementation on `staging`. This is the placement foundation for native
Shifts ownership. It does not yet switch tenant-wide schedule defaults to office
defaults or claim complete operational office isolation. No hosted data changes.

Follow-up: [phase 2D4B2](STANDARD_SCHEDULE_OFFICES_R10.md) implements Standard
schedule offices and defaults using these dated workplace windows. Flexible plans,
overrides and other operational families remain pending.

## Usage and meaning

Workplace is a dated working-office assignment for a staff profile. It is separate
from CRM's selected creation office, reporting manager, access profiles, team
membership and company/office grants. Changing any creation preference never moves
a workplace. Assigning a workplace never grants record access or office membership.
This model is industry-neutral and applies to scheduling profiles.

Administrators can open **Users > staff member or manager > Staff profile > Workplace**.
For a newly created login without a staff profile, explicitly save that profile
first. The page then shows the workplace controls without a reload. This step
does not assign a workplace, office access or service eligibility to a manager.
Business login creation alone never creates an employment profile.
Roster users with the relevant profile can select an individual staff member in
**Shifts > Roster** to see the same panel. Its history shows only offices they may
read. A selected date uses the tenant's business timezone, not the browser timezone.

1. Choose an eligible working office and effective date, then assign or schedule
   a transfer. The choice list intersects active offices/companies, the employee's
   office eligibility and the operator's office authority.
2. The preceding ongoing placement ends on the day before the transfer. Existing
   IDs, offices, original start dates and historical rows remain intact. Multiple
   dated transfers can be scheduled in order.
3. A future transfer can be canceled. Its row is retained as Canceled and its
   immediate predecessor reopens. Started placements cannot be canceled or
   backdated. Restoring a predecessor requires an active office/company and current
   eligibility for both employee and operator.
4. If another session changed the record, Save rejects the captured version.
   The draft stays visible until the user explicitly refreshes. A changed CRM
   preference cannot silently change the transfer target or source.

The panel does not reassign bookings or rewrite schedules. Current/future explicit
standard assignments, flexible recurring/week/daily plans, overrides and active
bookings overlapping the effective date must be resolved through their own flows
first. Overdue In progress bookings also block. Completed work before the change is
retained. Checks cover hidden work and return a generic conflict without source,
customer, service or private leave details.

Existing tenant-wide default schedules keep their current availability behavior
in this slice; workplace metadata does not yet select a different default. Native
plan ownership and the canonical office-aware working-time projection are the next
2D4 slice. Do not deploy office isolation with only this prerequisite in place.

## Authority and storage

Current Shifts activation, account/tenant status, profile actions and Read bounds
are rechecked inside the mutation transaction. `shiftRoster.edit` plus Read allows
assignment/transfer; cancellation additionally requires `shiftRoster.archive`.
Shifts resources support their existing None/All record limits, intersected with
office scope. A manager role label, reporting link or office membership alone grants
no new action. Tenant Admin retains existing tenant oversight.

Employees with roster Read retain personal placement history after grant revocation.
Other readers need source-office access. Historical access permits moving out of a
closed source office; destinations and restored predecessors must be active. An
operator who can see old office A but not the latest placement in B receives no B
identity and cannot overwrite it as if the employee were unassigned.

`StaffWorkplacePolicy` holds the optimistic version per staff profile;
`StaffWorkplaceAssignment` holds dated windows and canceled rows. Forced RLS applies
to both. Runtime code has no direct mutation policies. A protected writer resolves
the target itself, locks scheduling before tenant administration, checks fresh
authority and all conflicting work, changes windows/version and inserts the required
before/after audit atomically. Failure of the audit rolls the whole mutation back.
The scheduling lock serializes with booking, leave and plan writers. Tenant locking
serializes with company, membership and profile administration.

Bounded projections return source-authorized labels without exposing the protected
company directory. Reads, search and history are paged; writes require the captured
version and latest source identity. Audit visibility intersects every placement
referenced in its before/after copy, including a cancellation's restored office.
Request payloads cannot supply permissions, grants or alternate staff-profile IDs.

## Clean migration and release

Migration 119, `20261026000800_staff_workplaces`, adds only the two placement tables
and their functions/policies. Every pre-existing scheduling profile is placed once
in its tenant's initial office. The original beginning is unknown and stored as
null, displayed as **Start not recorded**. This preserves the original single-office
scheduling baseline without inventing employment dates. Missing tenant/initial-office
identity aborts migration rather than choosing another tenant or office.

The backfill changes no existing business rows, memberships, reporting relationships,
permissions, calendars, bookings, history, IDs or timestamps. It is migration-only:
new profiles remain unplaced until an explicit authorized assignment. There is no
runtime fallback to an initial office, CRM preference or tenant exception.

The disposable rehearsal preserves all 126 preceding tables exactly, including
representative existing assignments and private roster history; forced rollback
restores those rows and every prior policy. Pending R10 migrations still need the
agreed complete release gates: fresh encrypted backup and restore rehearsal,
restored-pilot visibility comparison, hosted staging validation and maintenance
cutover. No production migration or deployment is implied by these local checks.

## Verification

- `npm.cmd run test:workplaces`: 19 checks against isolated PostgreSQL using a
  nonprivileged runtime role and explicit office grants. Covers dated history,
  foreign/hidden/closed offices, self history, cancellation actions and conflicts,
  tenant-midnight boundaries, direct-write denial, stale/concurrent saves, refreshed
  authority after an observed lock wait and atomic audit failure.
- `npm.cmd run test:availability-boundary`: existing scheduling/privacy regressions.
- `npm.cmd run build`, then `npm.cmd run test:workplaces:browser`: real Chrome
  assignment, stale draft, explicit refresh, future cancellation, CRM preference
  independence and source-office visibility. Inspect its screenshot before claiming
  visual verification.

Final API and migration rehearsal (including audit version snapshots):
`tmp/industry-release/ls-erp-sales-orders-45801a1e28aa.log` (19 passed).
Existing workforce/appointment regression evidence:
`tmp/industry-release/ls-erp-sales-orders-217dc4fe5f12.log` (176 passed).
Final real Chrome flow and migration rehearsal:
`tmp/industry-release/ls-erp-sales-orders-be566ee52831.log` (1 passed).
The completed panel screenshot at `test-results/local-access/staff-workplace.png`
was inspected: history, current placement and the canceled transfer display cleanly;
canceled rows do not claim to be ongoing. Schema validation, final application
build/TypeScript, changed-file lint and whitespace checks passed. All evidence uses
local synthetic data. Nothing was pushed, migrated on a hosted database or deployed.

## Next 2D4 slice

The [protected Standard working-time prerequisite](STANDARD_WORKING_TIME_R10.md)
is now implemented locally in phase 2D4B1. The native boundaries below remain next.

Add native office ownership to schedules, assignments, overrides and flexible
plans, with office-specific default uniqueness. Resolve working-time integrity
through a protected canonical projection before ordinary plan reads gain office
RLS: filtering hidden source plans must never create a free slot or substitute a
different default. Use dated workplace windows for default selection, independent
of CRM creation preferences. Keep original rotation anchors and frozen history,
and require explicit resolution for assignments spanning a workplace transfer.
Complete selectors and history/audit privacy alongside those native boundaries.
