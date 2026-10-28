# R10 hosted workforce acceptance - phase 6D4

Verified on 2026-10-28 using one fresh synthetic fixture, `QA6W MVRNNB44`,
through normal APIs on the staging QA tenant aliases. Existing tenant users,
leave groups, office grants and business records were not edited. No application
or schema change, GitHub push, deployment or production write was made.

## Verified behavior

- Standard office default schedules, dated staff assignments, split working
  periods and unpaid breaks produce the expected neutral roster hours.
- Flexible weekly plans take precedence over recurring plans and daily
  availability. Unavailable overrides take precedence over those plans.
  Removing an override restores the weekly plan. Cloning an inactive recurring
  plan leaves its source active.
- Selected-staff leave groups expose only eligible definitions. Unassigned
  definitions, excessive duration and disallowed overlapping requests are rejected.
- Reporting-manager approval follows the saved reporting relationship, rather
  than team-manager membership. Self approval and unrelated/foreign reviewers
  are denied. Admin-only approval stays admin-only even for the reporting manager.
- A booked appointment blocks conflicting schedule changes and leave approval.
  Bulk approval rolls back every requested change when a conflict exists.
  Reviewers without booking Read receive no booking identifiers or details.
- Approval, rejection, cancellation and revocation follow their permitted
  transitions. Rejection/revocation require reasons. Valid bulk approval updates
  the exact requested rows.
- Roster Read works without template or general staff-directory Read. It exposes
  neutral hours without private leave reasons. Dated office transfers select the
  correct office default; other-office days are masked. Stale office context is
  rejected, and office/profile revocation removes access immediately.
- The owner retains personal leave history after the saved source office grant
  is revoked. That exception does not grant a manager the same history.

## Browser checks and execution limits

A real mobile form submission persisted one pending leave request. Its response
wait stalled after the server write, so the owned test browser was stopped. A
fresh exact-reason query found one row; the row was recovered without resubmitting.
The HTTP status of that particular browser submission is **not certified**.

The API runner reached its recorded 172-check checkpoint before that interruption.
Its in-memory final receipt was not completed. A separate completed recovery
receipt contains 36 checks, including terminal-state rechecks, the single saved
mobile request, both browser pages and office/profile revocation. These counts
overlap and must not be summed as unique assertions.

Two Chrome captures were visually inspected: the mobile leave list with the
saved request, and the desktop roster with only Roster permission. Neither page
overflowed the body or raised a page error. The roster capture covers the current
week's empty state: these test workplaces begin in 2036. Future working periods
and transfers were verified through the roster API. The grid does not consume
date query parameters, so a future-date screenshot was not claimed. Past frozen
roster history remains covered by earlier native tests, not this fresh fixture.

The initial runner expected daily availability to override a weekly plan. The
canonical SQL explicitly gives weekly plans priority; only the test expectation
changed. Scope denial can return 404 to hide record existence; the recovery
runner's initial 403-only expectation was corrected without changing access rules.
Earlier failures and cleanup corrections remain in private evidence.

## Cleanup and independent audit

The completed cleanup receipt contains **74 checks**. A separate read-only audit
passed **98 checks**, verifying:

- Seven leave requests are terminal: canceled, rejected or revoked; none remains
  pending or approved. The test appointment is canceled.
- Six accounts, three access profiles, the team, both offices and the company
  are archived. Explicit user business profiles and organizational grants are cleared.
- All three workplace history entries are canceled. Daily availability and the
  weekly override are removed; no live test schedules remain.
- Both recurring plans and shift templates remain inactive. Leave definitions,
  the selected-staff group and the referenced service remain inactive.

Historical request, assignment and schedule records were retained through normal
application behavior. Cleanup corrected three utility assumptions: schedule
details use the list API, schedule DELETE requires a JSON body, and template
updates accept an input DTO rather than nullable response-only fields.

The final read-only staging database check confirmed project
`oyhsrcmjhwxhvepdbcdc`, 132 applied migrations, no pending or rolled-back attempts,
and a non-superuser/non-bypass `prisma_app` login. The source manifest still
matches the 132-migration candidate. A fresh Vercel metadata read returned HTTP
403. The last verified staging candidate remains `525b853`; deployment/alias
identity and production alias identity must be refreshed after authentication
before any release claim. No deployment change was attempted here.

Private evidence lives under `tmp/industry-release/phase6d4/MVRNNB44`, with
utilities and receipt hashes retained in the existing private staging recovery
checkpoint. That checkpoint is not a new database backup or standalone recovery
tool. Credentials, environment files and browser session state are excluded.

Next gates: invitation acceptance/expiry, multiple managers on one team, module
activation and the remaining browser-write/sharing paths. This checkpoint does
not approve production release.
