# Protected effective working time — R10 phase 2D4B3A

Local implementation on `staging`. This is the integrity prerequisite for native
Flexible-plan and daily-override office ownership, following the same sequence as
Standard phases 2D4B1/B2. It does not add those ownership fields or source RLS yet.
Nothing is pushed, migrated on a hosted database or deployed.

## Completed behavior

Live appointment checks and the before/after plan-booking guard use
`modules/workforce/working-time.ts`. Neither consumer reads ordinary Flexible
plans, daily slots, overrides or source templates to decide effective hours.
The old separate TypeScript Standard and Flexible timing adapters are removed;
there is one application timing adapter and no compatibility forwarding layer.

The protected `app.effective_working_time` projection resolves the employee's
current scheduling mode and retains this precedence:

1. A daily override wins for either scheduling mode. An unavailable override
   suppresses every lower source.
2. Flexible mode uses the calendar week's explicit day, then the latest eligible
   recurring pattern, then daily slots. Explicit off days suppress fallback;
   missing or empty non-off days retain the existing fallback behavior. An empty
   day in the chosen recurring pattern does not revive an older overlapping one.
3. Standard mode uses the protected Standard projection, including dated-workplace
   defaults, explicit assignments and the original rotation rules.

Recurring cycles remain anchored to `validFrom`, including non-Monday anchors.
Weekly dates use calendar Mondays. Start/end boundaries, deterministic recurring
precedence, multiple slots and break clipping/merging remain unchanged. Flexible
timings reuse the private canonical helper used by history; Standard timings use
the existing protected Standard function. Frozen history is not rewritten.

Each returned row contains only the requested profile ID, calendar date and slot
timings/breaks. It carries no source, template, break or office IDs, names, off-day
causes or leave fields. Unavailable working-time responses use a generic message.
Approved leave remains a separate protected unavailable-date check above working
time, with the same privacy contract as before.

Source Read denial, hidden source rows and disabled Shifts cannot erase effective
hours for an independently authorized active booking consumer. This grants no
source Read, staff-directory access, assignment, approval or write capability.
Ordinary source detail and mutation APIs retain their own authorization.

## Authority, bounds and atomicity

Every database invocation reuses the current working-time authority gate: active
tenant/account, current profiles and Read rules, plus an enabled legitimate
consumer. Manager/Staff labels confer no capability. A disabled source module
does not disable an authorized independent consumer.

Batches allow at most 200 owned profiles and 366 finite calendar dates. Foreign or
missing profiles, null profile entries and invalid/reversed ranges reject the
whole batch. The adapter deduplicates IDs, batches longer internal selections,
rechecks authority on each batch and returns no partial resolver after revocation.
Resolving another requested day performs no additional database work.

The plan guard still pages all affected active/future bookings, including overdue
work in progress; it retains its tenant-calendar filtering, bounded query pages
and before/after regression comparison. Effective hours resolve the actual current
mode inside each projection call. Final writes remain under the shared scheduling
lock. Incompatible changes roll back source records, history and required audit;
conflict details still require ordinary appointment access after rollback.

## Migration and remaining work

Migration 122, `20261026001100_private_effective_working_time`, adds a protected
function only. Its rehearsal compares all 128 preceding tables and every prior
policy exactly, including schedules, plans, grants, snapshots and private leave
evidence. Existing canonical source functions are also unchanged. A forced final
failure proves rollback removes the new function and preserves the baseline.

Flexible weekly/recurring ownership is now implemented locally in phase
2D4B3B1; see `FLEXIBLE_PLAN_OFFICES_R10.md`. Native immutable tenant/office
ownership for daily slots and daily overrides is implemented locally in phase
2D4B3B2, including office-aware audits, captured creation context
and protected dated-workplace week-off selection; see `DAILY_ROSTER_OFFICES_R10.md`.
Weekly/recurring anchors and frozen history are preserved. Workforce selectors
and roster alignment remain pending.
Appointments and remaining operational ownership still gate the R10 release.

## Verification commands

- `npm.cmd run test:effective-working-time`: protected effective-time cases plus
  existing Standard, schedule-office, workplace and leave-office checks.
- `npm.cmd run test:availability-boundary`: workforce/appointment regressions.
- After building, `npm.cmd run test:effective-working-time:browser`: isolated
  Chrome sign-in and booking/template workflows with hidden source records.

All tests use synthetic data in a disposable local database. The browser workflow
tests authenticated behavior; this phase has no new UI and makes no visual claim.

Verified locally without skips: all 75 focused/office-boundary checks, all 176
workforce/appointment regressions and the real Chrome workflow. Final application
build/TypeScript, changed-file lint and whitespace checks passed.

Evidence:

- `tmp/industry-release/ls-erp-sales-orders-3d7f79601762.log`: 75 focused and
  existing office-boundary checks, plus migration rollback/preservation rehearsal.
- `tmp/industry-release/ls-erp-sales-orders-298f3f7225ec.log`: final 176 regressions.
- `tmp/industry-release/ls-erp-sales-orders-a1523664da27.log`: authenticated Chrome
  checks for hidden weekly slots/breaks, overriding timings/unavailability, valid
  bookings, incompatible template-edit rollback, disabled Shifts and suspension.

These checks use local synthetic fixtures, not a restored pilot-client database.
No push, hosted migration, deployment or client-data change was performed.
