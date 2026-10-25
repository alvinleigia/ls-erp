# R10 phase 2D4B1: protected Standard working time

Local implementation on `staging`. This is the integrity prerequisite within the
office-schedule phase. It does **not** add office-specific defaults yet, enable
native Shifts office RLS or claim complete operational office isolation.

## Completed behavior

Appointment availability, appointment create/edit/bulk moves, order scheduling and
the before/after plan-booking guard obtain Standard hours through
`modules/workforce/standard-working-time.ts`. They no longer select Standard
schedules through ordinary source queries. A hidden assignment still overrides a
visible default. A hidden default remains effective when no assignment applies.
An explicit schedule with no blocks, before its start or on a non-working day does
not silently substitute default hours.

The protected database projection returns only requested profile IDs, dates,
working start/end times and break timings. No schedule, assignment, block, template
or break IDs, source labels, office identities or customer fields are returned.
The existing shared `workingSegments` helper clips and merges breaks. The internal
availability result is now `{ ok: true }` or `{ ok: false, reason }`; successful
availability never carries a template identifier. HTTP availability retains its
existing available/reason contract.

The projection preserves the current Standard rotation: schedule-start anchor,
ordered repeat blocks, assignment date ranges, descending assignment precedence,
primary weekly off days and optional month-ordinal secondary off days. Off days do
not advance the cycle; assignment starts do not restart it. Equal block sort keys
use ID order consistently in the source adapter, API and protected computation.
The source renderer remains a preview/detail implementation; private SQL is the
working-time authority and parity tests exercise the shared rotation contract.

Shared-template edits now page tenant staff through the existing booking guard.
They do not infer affected staff only from visible schedule/assignment rows.
Only an actual before/after booking regression blocks the edit. A booking on a
hidden schedule therefore protects its template; failure rolls back template,
break, history and audit changes in the existing scheduling transaction.

## Authority and bounds

Every projection invocation checks active tenant/account, current profiles, Read
rules and at least one enabled legitimate consumer: Appointments, relevant Shifts
resources or configured Leave approvals. Manager/Staff labels grant no capability.
Tenant Admin still needs an active consumer module. Hidden source rows and disabled
Shifts do not erase hours when an authorized active booking consumer needs them.
No invocation grants a write action, source Read or assignment-directory access.

SQL accepts at most 200 profiles and 366 calendar days, rejects invalid/reversed
dates, and rejects a mixed foreign/missing profile selection as a whole. The server
adapter deduplicates IDs and batches longer ranges and larger internal selections;
every batch rechecks current authority. Revocation fails the whole operation rather
than returning the earlier batches as a partial availability result. No actor or
tenant fallback is invented.

## Migration and remaining work

Migration 120, `20261026000900_private_standard_working_time`, adds protected
functions only. Its rehearsal proves exact preservation of all 128 preceding
tables and policies, including workplace windows, schedule assignments, frozen
history, bookings, grants and timestamps. Forced rollback restores the preceding
state. It changes no client data, schema columns, activation settings or grants.

Native schedule/assignment office identity, per-office default uniqueness, dated
workplace default selection and office-aware selectors are next. Their migration
must also address source-independent history capture and audit/history visibility;
the ordinary Standard source adapter is still used for history here. Flexible
plans and overrides retain their current adapters and require equivalent private
working-time support before their source office RLS is enabled. No partial native
ownership or runtime legacy fallback is introduced in this slice.

Complete the pending R10 operational families and release gates before exposing
office isolation: encrypted backup/restore rehearsal, restored-pilot access
comparison, hosted staging validation and an agreed maintenance cutover.

## Verification

- `npm.cmd run test:working-time`: 12 focused checks on isolated PostgreSQL using
  a nonprivileged runtime role. Restrictive test policies hide source schedules,
  assignments, templates and breaks. Covers rotation across leap/calendar changes,
  hidden defaults and assignments, no false default substitution, break clipping,
  source-module deactivation, current authority, foreign/invalid requests, 201
  profiles across 367 days and atomic rejection of an incompatible template edit.
- `npm.cmd run test:availability-boundary`: workforce and appointment regressions.
- After `npm.cmd run build`, `npm.cmd run test:working-time:browser`: real Chrome
  authentication and API workflows for hidden-source denial, valid/invalid booking,
  source module deactivation, template-change rollback and suspension. This is an
  authenticated workflow check, not visual verification of new UI.

Verified locally: all 12 focused checks, all 176 regressions and the real Chrome
workflow passed without skips. Final build/TypeScript, targeted lint and whitespace
checks passed. Evidence uses synthetic local data only:

- `tmp/industry-release/ls-erp-sales-orders-0ec9c58ba53c.log`: final focused checks,
  migration rollback/preservation rehearsal and Chrome workflow.
- `tmp/industry-release/ls-erp-sales-orders-71c38c096b11.log`: workforce/appointment
  regressions.

No visual UI verification is claimed. No push, hosted migration, deployment or
client-data change was performed.
