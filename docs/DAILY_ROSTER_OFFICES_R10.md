# Daily roster offices - R10 phase 2D4B3B2

Local, unreleased. This slice adds native office ownership for daily Flexible
availability slots and daily template/unavailable overrides. It follows weekly
and recurring ownership in `FLEXIBLE_PLAN_OFFICES_R10.md`.

## Source authority

Both roots have required, immutable tenant and office fields. Staff, date and
slot position are immutable identities. Current `shiftRoster.read`, the requested
Edit/Archive action, Shifts activation, active account/tenant and office authority
remain independent requirements. Directory grants confer no business actions.
Restrictive database policies protect source rows and office-tagged audit copies;
native triggers independently enforce write authority and identities.

New dates capture the workspace office/version when the form opens. Stale forms
conflict without rerouting. New records require an active employee with office
eligibility and a dated workplace matching that date; new daily slots also require
Flexible mode. Overrides apply to either scheduling mode. No initial-office
fallback exists at runtime. Existing date edits retain their source office when
the workspace preference or employee membership changes. The actor still needs
active source-office write authority. Closed offices retain Read and reject edits
and deletion; the editor shows a saved source office and disables its write controls.

Override updates use explicit find/update/create rather than an upsert that runs
an insert guard for an existing record. Slot saves retain IDs at matching positions,
insert replacement positions before removing old ones, and reject duplicate
positions. Edit can shorten a slot list while retaining a slot; clearing the day
requires Archive. API deletions always require Archive. A hidden collision cannot
silently replace or adopt a different office's source record.

Bulk overrides allow at most 366 dates. New dates must belong to the captured
office; an existing range may include several offices if the actor can write each
source. Preflight and source/history/booking/audit changes share one transaction
and scheduling lock. A denied date or conflict rolls back the whole range.
Empty deletions and fully skipped ranges emit no mutation audit.
New-date preflight and override inserts/updates are batched; native per-record
guards remain active for the entire range. Existing records retain their IDs.

Daily audit snapshots are partitioned by source office, including bulk operations
crossing a dated workplace transfer. Office A's entry contains only A's records;
the same request ID ties the entries together for authorized multi-office review.

## Week-off selection, timing and history

Bulk skip-weekoff selection uses a bounded private projection of the schedule
eligible for each dated workplace. A matching explicit assignment takes precedence
over that office's default. Schedule start dates, weekday rules and selected
second-weekoff occurrences retain their existing behavior. It returns selected
dates only, without schedule/template IDs or labels. Hidden schedule source Read
does not erase week-off rules. Holidays are excluded separately. Skipped dates and
their existing history stay unchanged.

Canonical Flexible daily fallback, daily-override effective time and history
capture now require the source office to match the employee's dated workplace.
Overrides retain precedence for either mode; unavailable overrides suppress lower
sources. Weekly/recurring precedence and break calculations are unchanged. Hidden
source rows and disabled Shifts still affect independently authorized booking
consumers through the protected timing adapter. Ordinary source Read is not granted.

Existing frozen history is not rewritten by migration or incidental reads.
Explicit historical daily corrections retain replace-only-affected-dates behavior,
including higher-priority leave and history office boundaries. Booking guards
compare before/after effective time; incompatible saves/deletes roll back records,
history and required audits. Conflict details retain independent appointment access.

## Migration and verification

Migration `20261026001300_daily_roster_offices` backfills existing daily roots once
to the tenant's initial office and tags corresponding daily audit arrays. The
rehearsal compares all 128 preceding tables, excluding only explicit ownership
metadata. IDs, dates, positions, timestamps, template references, frozen history,
private leave evidence, grants and permission policies remain unchanged. Forced
rollback restores the original source functions and policies exactly. No legacy
runtime adapter or tenant-specific exception is introduced.

Old regression fixtures have a local-only insertion helper; the native daily suite
asserts it is absent. It is not included in production migration SQL. Older tests
that intend business writes use the authorized plan transaction; raw historical
fixture insertion uses only the disposable database's owner connection.

Commands:

- `npm.cmd run test:daily-roster-offices`
- `npm.cmd run test:flexible-plan-offices`
- `npm.cmd run test:availability-boundary`
- `npm.cmd run build`
- After building, `npm.cmd run test:daily-roster-offices:browser`

All fixtures are synthetic and local. These checks do not certify a restored-client
upgrade or a hosted deployment. No client data is modified. Workforce selectors
and roster presentation alignment, appointment ownership and the remaining
operational/release checks still follow; R10 is not ready for production release.

Verified locally without skips:

- 18 native daily checks, including the full 366-date historical correction and
  its 366 history entries: `tmp/industry-release/ls-erp-sales-orders-38553215383e.log`.
- 91 preceding Flexible/Standard/workplace/leave boundary checks:
  `tmp/industry-release/ls-erp-sales-orders-bfc9a8eac112.log`.
- 176 workforce/appointment regressions after the final ownership guards and
  batched writes: `tmp/industry-release/ls-erp-sales-orders-284ef2e76b50.log`.

Application build/TypeScript and changed-file lint passed.
The real Chrome workflow passed captured-office conflict/draft retention, new
override creation, source-office editing after workspace changes, retained slot
IDs, scoped manager Read and audit partitioning. The override editor and roster
screenshots were inspected. Evidence:
`tmp/industry-release/ls-erp-sales-orders-c8dd48d2a2dd.log`.
Final whitespace checks passed. Nothing was pushed, migrated on a hosted database
or deployed; client data is unchanged.
