# Standard schedule offices — R10 phase 2D4B2

Local implementation on `staging`; not a hosted release. This completes Standard
schedule ownership and office-specific defaults. Flexible plans, daily overrides,
appointments and the remaining operational selectors still need their own native
office boundaries before R10 can be released.

## Ownership and access

Every Standard schedule has an immutable tenant and office. Blocks and staff
assignments inherit that identity through their schedule. Current Shifts activation,
profile actions and Read rules remain required alongside office access. A Manager
label or an office grant alone supplies no business permission. Closed offices
retain historical source Read; changes require an active office and company.

Schedule creation uses the shared office snapshot captured when the form opens.
A changed office preference/version rejects the save with 409 and retains the
draft; the server never silently reroutes it. Editing cannot move a schedule to
another office. Schedule audit copies carry the same office boundary, including
default replacement and ended assignments.

## Defaults and assignments

There is at most one default per tenant/office. Replacing East's default leaves
West's default unchanged. The shared scheduling lock serializes competing writes,
booking checks, history capture and required audits as one transaction.

Default selection follows the employee's dated workplace on each calendar day.
It never follows the creator's current office preference. Unplaced staff have no
Standard default. Transfers switch the effective default on the transfer date.
Explicit assignments must have workplace coverage in the schedule's office for
their entire interval; an open-ended assignment needs ongoing coverage. Staff
must have a Standard profile and office eligibility. No profile or workplace is
silently created during schedule assignment.

Renaming/editing an unchanged assignment preserves its ID and existing participant
links, including staff whose eligibility subsequently changed. Ending an existing
assignment can narrow its interval after staff eligibility is revoked; it cannot
extend that interval or bypass the actor's current source-office/action checks.
Changing participants or assignment dates requires fresh validation. Overlap
checks include source assignments hidden by office scope.

The roster receives default choices per employee/day and only the source schedules
the caller can read. It never substitutes another visible office's default when
the actual source is hidden. Booking integrity continues to use the protected
timing-only projection from phase 2D4B1, independently of ordinary source Read.
Rotation anchors, ordered blocks, off days and break calculations are unchanged.

## Canonical history

`StaffRosterHistoryDay` is itself tenant/office owned. Its office is the dated
workplace for that day; a leave record supplies its real source office only when
there is no workplace. A profile with neither gets no invented historical office.
Frozen office identity cannot be changed during regeneration.

`app.sync_roster_history` is the only runtime history writer. It reconstructs
Standard, Flexible and override timings from protected canonical sources; callers
cannot supply paid minutes, template names or leave details. Direct runtime
INSERT/UPDATE/DELETE is denied. Batches are bounded to 200 owned profiles and 366
past dates, reject mixed foreign/missing profiles as a whole, and recheck current
authority. Future days cannot be pre-frozen. Insert-missing capture preserves
existing snapshots; replacement requires the applicable roster/leave authority.

Daily history Read is independent of live schedule Read: staff retain their own
history after transfer/grant revocation, and authorized office roster readers can
read that office's daily work without acquiring a source schedule pattern.
Private leave evidence remains in `StaffRosterLeaveSnapshot`, with its existing
source/reviewer rules. Generic history does not disclose leave causes or reasons.

Shared-template edits capture affected history through protected functions,
including source schedules hidden from the editor. Template archive checks use a
protected references predicate, so hidden usage cannot cause a foreign-key error
or an unsafe deletion. Failed integrity or audit checks roll back the complete
operation. The removed ordinary `standard-availability` history adapter has no
runtime compatibility replacement.

## Migration and verification

Migration 121 (`20261026001000_standard_schedule_offices`) backfills existing
schedules and frozen history once to their tenant's initial office, consistent
with the earlier workplace baseline. It replaces tenant-wide default uniqueness
with tenant/office uniqueness. Historical schedule audit copies receive office
metadata once. No runtime initial-office fallback or tenant exception is added.

The migration rehearsal compares all 128 preceding tables, excluding only the new
ownership/audit fields, and proves that original IDs, timestamps, source values,
grants and private leave evidence are unchanged. Forced rollback restores the
old rows and policies. Historical leave hydration triggers are suspended only for
the ownership backfill, so frozen private evidence is not recomputed.

Run `npm.cmd run test:schedule-offices` for native schedule, workplace, leave-office
and protected working-time checks. Run `npm.cmd run test:schedule-offices:browser`
after building for the isolated Chrome draft/default/manager workflow. Both use a
disposable local database and synthetic accounts, never the pilot tenant.

Verified locally without skips: all 63 native schedule/workplace/leave/working-time
checks, all 176 workforce/appointment regressions and the real Chrome workflow.
The latter covers retained stale drafts, source-office labels, independent office
defaults, dated transfer choices, hidden-office source denial and saving an
unchanged historical rotation anchor. The form and scoped-list screenshots were
visually inspected. Final application build/TypeScript, changed-file lint and
whitespace checks passed.

Evidence:

- `tmp/industry-release/ls-erp-sales-orders-aae84d52dbd0.log`: final 63 native
  checks, including hidden-office template archive protection, plus migration
  rollback/preservation rehearsal.
- `tmp/industry-release/ls-erp-sales-orders-daf889a3724c.log`: final 176 regressions.
- `tmp/industry-release/ls-erp-sales-orders-a008a156c1ef.log`: final Chrome workflow.
- `test-results/local-access/schedule-office-form.png` and
  `test-results/local-access/schedule-office-list.png`: inspected screenshots.

These are local synthetic checks, not a restored-client release rehearsal. No
push, hosted migration, deployment or client-data change was performed.
