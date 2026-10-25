# R10 phase 2D3: leave ownership and private roster evidence

Local implementation on `staging`. This completes the Leaves ownership slice,
not all workforce or operational office isolation. Shifts, bookings, purchasing,
stock boundaries, selectors and workspace controls remain release prerequisites.
No hosted database or client data is changed during local development.

## Request ownership and access

Each leave request has a required, immutable tenant and office. Existing requests
enter the initial office without changing IDs, employees, reporting relationships,
status, reasons, timestamps or permission grants. Missing tenant IDs are derived
from the existing employee; conflicting nonempty tenant identities abort migration.

New requests use the shared creation-office context. The Apply leave panel captures
the office and preference version when opened. A changed preference returns 409;
missing or revoked creation access returns 403. No office is silently selected.
Staff-profile creation, rule validation, request creation and mandatory submission
audit commit together under the shared scheduling lock. Concurrent submissions
therefore cannot exceed the pending-request limit through a race.

Access intersects current profiles, action/Read limits and module activation:

| Actor | Request and private history access |
| --- | --- |
| Employee | Own records with personal Read, including original-office history after transfer or membership revocation |
| Configured reporting reviewer | Reporting relationship, approval Read and membership for that source office are all required |
| Other manager/team manager | No approval authority from a role label, team membership or an office grant alone |
| Tenant administrator | Existing tenant oversight, bounded by the Leaves module for private history disclosure |

Ordinary office grants do not expose company-directory administration. Reviewer
authorization uses protected source checks rather than ORM joins to that private
directory. Closed offices retain authorized historical reads; reviewer writes
require an active office/company. Personal cancellation remains available under
the existing cancellation rules and permission, including after an office transfer.
Offices, original request details and employee identities cannot be changed through
a status transition. Review, cancel, revoke and bulk APIs retain their existing
lifecycle checks, scheduling conflicts, atomic audit/history writes and fresh
authority checks. Definitions, groups and existing business calendars remain
tenant-shared configuration; company-specific HR policies are a separate feature.

## Private history normalization

Private leave evidence now lives in `StaffRosterLeaveSnapshot`, a one-to-one child
of the generic roster history day. It stores the source request/office and the
saved leave classification and reason. Forced RLS applies the same personal or
configured-reviewer access as the source. Runtime application queries cannot write
this private table directly.

`StaffRosterHistoryDay` no longer stores leave IDs, codes, names or reasons. Its
ordinary representation is simply Unavailable with zero working minutes. A caller
authorized for the private snapshot sees its original Leave classification and
saved fields in the roster response. A caller without access, or with Leaves
disabled, receives generic availability without the private cause.

Canonical database triggers populate private evidence inside the history writer's
transaction. A hidden approved leave therefore cannot be overwritten as working
time by another office's roster refresh. The scheduling writer receives no private
source fields. Missing-history capture preserves existing snapshots; explicit
corrections retain the existing regeneration semantics. The shared private busy
projections still protect booking and plan integrity independently of source Read.

Request audit copies, including bulk source lists, obey source visibility. Email
eligibility is checked against the current actor, recipient profile, reporting
relationship and source office before sending. An unassigned manager does not
receive a private request through an email notification.

## Migration and release

Migration 118, `20261026000700_leave_office_ownership`, performs a clean move of
private snapshot fields and removes their old columns. It adds no runtime legacy
adapter, implicit office grant or tenant-specific exception. Native office lookup
registers LeaveRequest; personal/reporting scope remains its explicit resource
policy, not sales sharing.

The disposable rehearsal inserts a populated historical snapshot whose saved
classification/reason differ from current source data, forces rollback, then
applies the migration and reconstructs all original history fields through the
new relation. This proves preservation of frozen values as well as IDs, dates,
timestamps, relationships and grants across all 125 preceding tables. Only new
ownership metadata, documented missing-tenant normalization and the physical move
of private fields change storage.

This schema and its application code must be released together in the agreed
maintenance cutover. Old application bundles expect the removed history columns;
rollback after a successful cutover uses the verified database recovery backup
with its matching application. Fresh encrypted backup/restore rehearsal, pilot
access comparison and hosted staging checks remain mandatory before release.

## Local verification

- `npm.cmd run test:workforce-offices`: explicit two-office fixtures, without
  implicit factory grants; source and audit privacy, transfer, action boundaries,
  notification eligibility, history reconstruction and transaction rollback.
- `npm.cmd run test:availability-boundary`: existing workforce/appointment behavior
  and privacy-safe scheduling guards against isolated PostgreSQL.
- `npm.cmd run build`, followed by
  `npm.cmd run test:workforce-offices:browser`: real Chrome form capture, stale
  context rejection, successful request, reviewer denial, membership revocation
  and private history checks. Inspect screenshots before claiming visual QA.

These checks certify local synthetic data only. They do not certify a hosted
deployment, a restored pilot database or completed operational office isolation.

Verified locally: 14 dedicated office checks and all 176 workforce/appointment
regressions passed, without skips. The real Chrome Apply leave flow passed against
the production build; its completed request screenshot was inspected. Three
notification unit checks also passed. Schema validation, build, TypeScript,
changed-file lint and whitespace checks passed.

Evidence is retained in ignored local reports:

- `tmp/industry-release/ls-erp-sales-orders-241a3f0164be.log`: dedicated office checks.
- `tmp/industry-release/ls-erp-sales-orders-199a14ad11c8.log`: regression suite.
- `tmp/industry-release/ls-erp-sales-orders-d2245113780d.log`: final Chrome flow and
  migration rollback, policy restoration and snapshot-preservation rehearsal.
- `test-results/local-access/leave-office-request.png`: inspected completed view.

Changes and migration remain local; no push or deployment was performed.
