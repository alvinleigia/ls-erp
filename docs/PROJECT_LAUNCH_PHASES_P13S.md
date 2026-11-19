# P13S — Project launch phases

## Behaviour

Launch phases are separate from the structural project hierarchy. A top-level
project owns its phases; units at any descendant level can select one phase of
that same project. There are no forced Phase/Block/Floor levels. Launch phases
inherit their project's company, office and access boundaries.

The project's **Launch phases** tab provides a paged list and audited, versioned
creation/editing for users who can edit the top-level project. A phase has a name,
unique project-wide code, booking status and optional opening date/time:

- Planned: no new reservations.
- Open: new reservations permitted after the opening time, or immediately when
  there is no opening time. The database clock checks this at request time.
- Paused or Closed: no new reservations. Either status can later be changed.

The opening control uses the browser time zone for entry, stores UTC, and displays
the saved time in the user's configured display time zone. A date on a Planned
phase does not open it; choose Open to allow reservations automatically at that
time. No cron job or background polling is needed.

Assign units from their catalog **Property unit** details. Assignment is explicit:
creating a phase does not silently assign or block existing units. Units without
a phase keep their prior availability. The catalog shows a Launch not open hint
alongside the existing availability value. The reservation panel explains phase
blocks and does not offer a new hold while the phase is blocked.

Existing unexpired holds remain idempotently retrievable and can still be
allocated on confirmed orders, released or cancelled. Allocated units stay
allocated. Phase changes do not modify orders, documents, payments, ownership,
staff assignments or the catalog's saved availability. Expired/released holds
must pass the current phase gate if a new hold is requested. Active holds and
allocations block phase/project reassignment of their units.

## Implementation

Migration `20261119000200_project_launch_phases` adds `RealEstateLaunchPhase`
and nullable `RealEstateUnit.launchPhaseId`. Existing units remain NULL; no launch
phases, sales or approvals are invented. Phase identity/root ownership is immutable;
ordinary edits require an incremented version. Phases are retained and closed,
rather than deleted. Application writes keep the existing domain audit transaction.

Forced RLS checks tenant, source project office and source project sharing. Service
calls also require the canonical project action and record scope. A phase does not
grant access to a project, customer or sales record. Native same-root guards reject
cross-project assignments. Native reservation insertion checks the phase under a
shared lock, so alternative callers cannot bypass the launch gate.

The generic catalog owns an optional, bounded `reservationBlocks` addon contract.
The real-estate addon supplies phase checks; the shared catalog/reservation engine
does not query industry tables itself. One batched check serves each already
authorized page/order unit set. Generic product and equipment behaviour is retained.
Application phase edits and hold writes use the existing tenant operation lock;
native row locks also serialize assignment/admission with phase updates.

Phases are prospective reservation controls, not legal transfer, tax, verification,
accounting or payment status. Accepted commercial facts and issued bytes remain
unchanged. No KYC or document issuance gate is added by this increment.

## Verification and rollout

- `npm.cmd run test:project-launch-phases`: isolated migration rollback/data
  preservation, native phase/access/scheduling checks and catalog, reservation,
  sales order and receivable regressions.
- `npm.cmd run test:project-launch-phases:browser`: isolated real application UI
  checks for phase creation/editing, scheduling, unit assignment and responsive UI.

Apply the hierarchy and launch-phase migrations before deploying this code.
Staging uses the existing guarded migration workflow; production requires the
controlled release and a fresh verified backup. Never run synthetic fixture tests
against a hosted client database. Client phase configuration is separate from
shipping the feature; existing units remain unchanged until explicitly configured.

Verified locally on 2026-11-19:

- 63 native/regression checks passed, including phase admission, direct database
  guards, root/tenant/sharing boundaries, retained assigned-staff access, audit
  rollback, concurrent phase edits, reservations, orders and payment recording.
- Migration forced rollback and exact preservation of all 180 preceding tables
  passed. Existing unit assignments remain NULL.
- One real browser flow passed phase creation/editing, inherited project context,
  unit assignment, UTC scheduling and resulting admission state. Desktop/mobile
  screenshots were inspected; no page errors or horizontal overflow.
- Production build/TypeScript, targeted ESLint and whitespace checks passed.
  Local demo has 162 applied migrations.

Evidence: `tmp/industry-release/ls-erp-sales-orders-6fa5b6205c3b.log` (final native
suite), `tmp/industry-release/ls-erp-sales-orders-5f61e2753a69.log` (final browser),
`tmp/project-launch-build.log` and
`test-results/project-launch-phases-{desktop,mobile}.png`.

No staging or production migration, configuration change or deployment is part
of this increment. No live Ewissen fixtures or changes were made.
