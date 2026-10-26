# Office-scoped roster Read - R10 phase 2D4C1

Local, unreleased. This slice corrects roster browsing and its staff filter.
The follow-up [phase 2D4C2](WORKFORCE_STAFF_CHOICES_R10.md) now provides local
office/date-bound schedule and recurring assignment choices and keeps roster
drafts tied to the clicked staff. Shifts no longer delegates the generic directory;
other modules retain their own lookup contracts.

## Read boundary

`GET /api/shifts/roster` requires current Shifts activation and `shiftRoster.read`.
Role labels, office grants or another module's Read never substitute for this
permission. The database independently repeats that gate. Staff names/email/mode
are a bounded module lookup within the viewer's permitted dated workplaces, not
tenant-wide directory access. Historical staff remain discoverable when their
saved history is readable; inactive status is shown. Personal frozen history
retains its existing Read exception after office membership revocation. Only
tenant admins can discover completely unplaced profiles for workplace setup.

The API returns a coherent page of staff and their days. Staff search and counts
use the same office/date predicates; page size is at most 100, and ranges cover
at most 62 consecutive dates. The UI exposes search, staff paging and refresh.
Changing dates/search/page clears the displayed read scope until its matching
response arrives; aborted/late responses cannot repopulate another scope. Errors
clear rows rather than leaving stale hours. Writes refresh the primary read view.

A transferring employee can have readable days and days outside the viewer's
offices in the same range. Outside days return no office identity, hours or edit
capability. Unplaced and missing-history days remain distinct unknown states,
with null minutes. They never become an invented working default or an off day.
Raw projection requests containing a foreign or wholly unreadable profile reject
the entire selection. Closed offices retain historical/current Read but cannot
advertise editable days. Metadata is a UI hint; mutation services retain their
independent current permissions, source-office and booking guards.

## Hours and privacy

Live roster hours come from the existing protected effective-time projection,
behind the additional roster office/date boundary. Hidden Standard/Flexible
configuration and breaks still affect the result. Approved leave suppresses
hours through the private availability projection even if its source is hidden.
The read response exposes neutral periods and minutes, with no plan/template/
break IDs, configuration names, leave IDs, classifications or reasons. Ordinary
source APIs and optional editor lookups retain their own Read requirements.

Past days use frozen minutes and bounds. Missing readable history is hydrated
only through the canonical insert-missing writer in the scheduling transaction;
existing snapshots are not reinterpreted or replaced. Source details in the
existing history endpoint remain independently protected historical evidence.
Explicitly authorized leave details may still overlay readable roster dates;
hidden causes are shown only as generic non-working time. Totals are labelled
as visible hours/leave counts for the current page and staff filter.

The grid and calendar share the same day projection. The roster's duplicate
Standard/Flexible/override timing calculations and their unused source queries
are removed. Config source reads still populate authorized editor drafts; a
missing source result cannot decide displayed hours. Calendar interactive QA is
subject to the existing calendar feature/license gate; Chrome checks cover Grid.

## Migration and release bounds

Migration `20261026001400_workforce_roster_read` adds projections only. Forced
rollback and application preserve all 128 preceding tables, policies, source
functions and function grants exactly. No tenant records, staff assignments,
IDs, anchors, frozen history or permissions are migrated or overridden. There is
no runtime legacy adapter or tenant-specific exception.

This is not the complete office-isolation release. Phase 2D4C2 follows this work
with captured/source office and date-window choices. Appointment ownership and
the remaining operational/release checks
also remain prerequisites. No hosted migration or deployment is performed.

Verification uses local synthetic tenants in a disposable database:

- `npm.cmd run test:roster-read`
- `npm.cmd run test:availability-boundary`
- `npm.cmd run build`
- After building, `npm.cmd run test:roster-read:browser`

These checks do not certify a restored-client upgrade or hosted deployment.

## Local evidence - 2026-10-26

- 11 native roster Read integration checks passed without skips: scoped lookup,
  protected hidden-source hours, transfers, private leave, archived/frozen history,
  personal history after revocation, unplaced profiles, closed offices, invalid
  native/API selections, fresh authorization and 107-profile paging/search.
  Evidence: `tmp/industry-release/ls-erp-sales-orders-12f6a8e8438c.log`.
- 176 existing availability, booking, workforce and appointment integration checks
  passed without skips. Evidence:
  `tmp/industry-release/ls-erp-sales-orders-6f6fdd5fca08.log`.
- Two real-sign-in Chrome scenarios passed: roster-only reader without source
  configuration access, 107-person paging/search, transferred dates, read-only
  cells, no directory calls, revocation clearing displayed rows, and saved tenant
  history while the browser still considers the date today. The complete stored
  history row was checked unchanged before/after. Evidence:
  `tmp/industry-release/ls-erp-sales-orders-c6a451a713bc.log`.
  The hours, revoked-empty and tenant-day screenshots were visually inspected.
  Calendar remains feature/license gated and was not interactively certified.
- The existing daily-override Chrome workflow also passed: captured office
  context rejects a stale form, saved edits retain their source office, and
  an office-limited manager sees only the permitted roster. Form and roster
  screenshots were inspected. Evidence:
  `tmp/industry-release/ls-erp-sales-orders-ef12cb9cd6ef.log`.
- Removed the now-unused browser timing/history adapters and template color
  mapping. Their obsolete UI-only assertions were replaced by roster input
  boundary coverage; canonical rotation/time-zone tests remain. All 15 workforce
  rule checks passed again after this cleanup.
- Production build (including TypeScript), targeted ESLint for all changed source
  and test files, and Git whitespace checks passed.
