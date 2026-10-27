# R10 phase 2D8D: combined office acceptance and readiness review

Local implementation on `staging`. No hosted database, tenant login, deployment
or production data was changed. This milestone completes the bounded combined
workflow review; it does not declare the whole R10 release ready.

## Combined behavior

- Direct onboarding saves only explicitly selected profiles and office grants.
  A staff/manager role, team leadership or creation preference supplies neither
  a missing business action nor an employee workplace.
- A manager leading multiple teams sees their records only within permitted
  offices and the configured Read scope. An unrelated team's records remain
  excluded even when its office is permitted. Company coverage includes child
  companies only when explicitly selected.
- Restricted visibility and selected sharing remain intersected with office
  eligibility, action profiles, module activation and current team authority.
  Read access cannot become Edit. Removing a profile immediately removes its
  business access without rewriting company grants or source records.
- Switching or clearing the creation office changes only that preference.
  Existing records retain their offices; readable populations, reporting links,
  profiles and dated workplaces are unchanged.
- Optional employment profiles require an explicit staff-profile Save before
  workplace assignment. Newly created accounts show this instruction rather
  than requesting a workplace for a nonexistent profile. Saving refreshes the
  page state and reveals the existing workplace controls. Manager targets now
  use the same supported profile path; service eligibility remains staff-only.
  A failed save releases its busy state and reports the failure.

## Native test contract

Run `npm.cmd run test:office-acceptance` for the combined API checks. Build first,
then run `npm.cmd run test:office-acceptance:browser` for the same API checks and
real-sign-in Chrome flows. The guarded runner creates an isolated disposable
PostgreSQL database and never loads hosted connection files or saved sessions.

All three historical fixture aids are disabled: `R10_SINGLE_OFFICE_FIXTURES`,
`R10_DAILY_FIXTURES` and `R10_BOOKING_FIXTURES`. Inventory browser fixtures now
explicitly grant their named offices through the membership API. Historical
workplace conflict fixtures supply their canonical tenant/office identities.
No runtime fallback, automatic grants or compatibility trigger was introduced.

The suite combines onboarding/invitations, membership editing, office eligibility,
workspace preferences, native CRM/sales roots, workplaces, assignment choices,
bookings, inventory, source coupon reports, composed audits and resource contracts.
Its new matrix crosses multiple managed teams, parent/child companies, exact grants,
read-only profiles, Restricted sharing, employee placement and current revocation.

## Verification

Verification evidence for this phase is local under ignored
`tmp/industry-release/ls-erp-sales-orders-1638402c0d90.log`,
`tmp/industry-release/phase2d8d-build.log`,
`tmp/industry-release/phase2d8d-browser-focused.log` and `test-results/local-access`.

- All 178 combined API/access/resource tests passed, with zero skips.
- The disposable rehearsal applied all 129 migrations, verified rollback and
  preceding data preservation, and passed the 18 native Inventory checks.
- All 18 distinct real-sign-in Chrome flows passed: 17 in the combined run and
  the new journey in its focused rerun after correcting a test wait that had
  checked before the assignment request completed. Staff and Manager profile
  initialization, explicit placement, office changes, team Read and revocation
  are verified in that journey. Desktop and mobile screenshots were inspected;
  the mobile page has no horizontal overflow.
- TypeScript, changed-source ESLint, whitespace checks and the production build passed.

## Release inventory and next work

The directory, native operational/source boundaries, protected integrity adapters,
resource registry and office/onboarding/workspace controls have local contracts
and regressions. Existing pilot IDs, staff assignments, teams, frozen financial
snapshots and explicit access must remain unchanged during a real cutover.

Next is phase 3: industry-neutral external collaborator identities, separate from
employee profiles, with explicit supervisors and the same bounded login/access
lifecycle. Phase 4 adds separate partner attribution and reporting dimensions;
business totals must count an outcome once. Parent-company administrative oversight
and organizational membership must continue to use explicit authority.

Before hosted staging: take a fresh encrypted, restore-tested backup, rehearse the
complete migration chain against a copy, compare the pilot's IDs/owners/access and
verify the actual packaged deployment. Those recovery and hosted acceptance gates
remain pending. Production still needs its own authorized release window. No local
acceptance count replaces those gates or claims collaborator/attribution completion.
