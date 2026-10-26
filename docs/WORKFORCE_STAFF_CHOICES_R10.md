# Workforce staff choices - R10 phase 2D4C2

Local and unreleased. Standard schedule assignments and recurring-plan creation/
assignment use one paged, searchable lookup and shared staff picker. Shifts no
longer delegates tenant-wide staff access to `/api/directory`. Other modules keep
their current lookup contracts until their own operational office work is done.

## Assignment boundary

`GET /api/shifts/staff-choices` accepts `family=SCHEDULE|PATTERN` and
`action=browse|create|edit`. It refreshes activation, profile actions and record
limits after taking a shared scheduling lock. Scheduling mutations take the
exclusive counterpart. The protected database function repeats the capability
checks and bounds paging, dates and selections. The private membership predicate
remains inaccessible to ordinary application roles.

Creating requires the office/version captured when the form opened. A preference
change causes a conflict; the draft cannot silently switch destination. Editing
resolves its office from the readable saved source, independently of workspace
preference. Hidden/foreign/missing sources return the same not-found result.
Closed offices retain browse/history access and reject new/edit choices.

Candidates need an existing profile, active account, correct scheduling mode,
office assignment membership and one uncanceled workplace placement covering the
entire window. An open-ended window requires an open-ended placement. The lookup mirrors
the native Standard/Flexible coverage guards in one set-based query, reusing the
private membership predicate after establishing the caller's office access once.
These are eligibility hints: overlap, booking integrity,
expanded windows, changes in status/permissions and all native mutation checks
remain authoritative at Save. The lookup does not grant assignments.

Read-only list filters contain staff from readable schedules or recurring plans,
including former staff. They do not require Users Read, workspace selection or
write permissions. A mode change does not erase names on historical sources.
Saved assignees are returned separately from new eligibility. A former/transferred
assignee can stay selected for an unchanged assignment; removal is explicit, and
an ineligible removed person cannot be selected as a new target. Arbitrary selected
IDs cannot reveal names from outside the lookup/source scope.

## UI and bounded reads

The shared picker searches on the server and pages 20 rows at a time (API maximum
100). Selected names are resolved within the same authorized scope even when they
are outside the current search/page. Up to 100 selected staff are supported. A new
date, search or page hides the previous result while loading; aborted/late results
cannot restore another query's choices. Errors clear options and preserve the
draft's submitted selection. Native saves recheck all security and office context.

Source visibility is resolved once per lookup, and search narrows candidates
before coverage evaluation. The bounded lookup disables PostgreSQL JIT locally;
this does not change any session-wide setting or access policy. Readers share the
scheduling lock, so successive picker requests do not serialize behind each other.

Roster editors now keep the staff member of the clicked row fixed. To work on
another person, close the draft and select their roster row. Weekly/recurring
source staff are immutable; daily and bulk date mutations retain their native
office/coverage checks. Recurring detail edits show the saved staff label directly,
so an archived or transferred assignee does not disappear from a disabled picker.
Appointment conflict reassignment is an Appointments workflow, not certified by
this lookup; appointment ownership remains the next operational prerequisite.

## Migration and verification

Migration `20261026001500_workforce_staff_choices` adds lookup functions only.
Forced rollback and application preserve all 128 preceding tables, policies,
source functions and grants exactly. No tenant, workplace, assignment, source,
history or permission row is migrated, normalized or overridden.

Run against disposable synthetic local data:

- `npm.cmd run test:workforce-staff-choices`
- `npm.cmd run build`
- `npm.cmd run test:workforce-staff-choices:browser`

The browser command includes the existing schedule, recurring, daily-roster and
roster-read workflows. Inspect their screenshots before claiming visual QA.
This does not certify a restored-client upgrade, Calendar mode or a hosted release.

## Local evidence - 2026-10-26

- 17 native/core integration checks passed, without skips. Coverage includes
  source-scoped browse, Standard/Flexible eligibility, full/open-ended windows,
  archived/transferred retained selections, foreign/hidden sources, arbitrary
  selected IDs, captured context, closed offices, fresh module/office revocation,
  generic-directory delegation removal and 107-person paging in both modes.
  Evidence: `tmp/industry-release/ls-erp-sales-orders-8e6626284490.log`.
- Seven Chrome scenarios passed against the completed build, with real sign-ins
  and synthetic tenants: new staff picker/search/paging/stale context, unchanged
  former assignment/source office on save, and the existing Standard, recurring,
  daily-roster, scoped roster-read and tenant-day history workflows. The picker,
  retained-selection and source-office form screenshots were visually inspected.
  Evidence: `tmp/industry-release/ls-erp-sales-orders-8ffb9ed8c270.log`.
- Migration rollback/application rehearsals preserved all preceding rows,
  policies, source functions and grants exactly. Production build/TypeScript,
  targeted ESLint for all changed source/test files and whitespace checks passed.

No hosted migration, push, deployment or client-data write was performed.
