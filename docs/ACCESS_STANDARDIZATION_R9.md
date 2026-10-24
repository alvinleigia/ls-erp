# R9: resource/action access standardization

Work target: local staging branch. Hosted/production data is unchanged.

The final contract is tenant isolation + module activation + composed profile
permissions + per-user resource/action record limits + native business rules.
Staff and Manager account labels do not grant business capabilities. Tenant
administration and customer/personal entrypoints retain their security boundaries.

## Implementation checklist

- [x] Replace sales/project scope columns with one permission-keyed rule document.
- [x] Register supported/default scopes for every resource and validate all rules.
- [x] Use an explicit operation context; related lookups use Read and mutations
      use their own action. Read bounds every other action.
- [x] Standardize sales, contacts/accounts, activities, projects and linked sales
      documents/orders/receivables/reservations across reads and writes.
- [x] Replace Staff/Manager business gates in operational APIs, services,
      dashboards, page metadata and navigation with permissions/policies.
- [x] Separate membership inspection from record inspection and restricted-field
      authority from job labels through ordinary permission resources.
- [x] Preserve leave approval routing as explicit employment configuration.
- [x] Expose per-resource/action access limits in assignment and user creation.
- [x] One-time migration translates old account ceilings and scope choices into
      ordinary rule data. No tenant-specific overrides or runtime old-mode branch.
- [x] Rehearse data/authority preservation, delegated Staff profiles, read-all /
      edit-own, secondary actions, selectors, exports and source privacy.

Shared/reference records support tenant-wide access or None; owned/assigned
records support only scopes their adapters can enforce. Reporting and approval
relationships remain domain data. A filter can narrow access, never expand it.

Pending migrations must ship with the matching code after backup/rehearsal checks.

## Verification on 2026-10-25

All database checks use disposable local PostgreSQL containers, synthetic users
and forced RLS. They never load hosted database credentials or tenant seed/reset
scripts. Counts overlap between groups; they are not an aggregate test total.

| Check | Result |
| --- | --- |
| ERP access (`node scripts/test-sales-orders.cjs --access`) | 256 passed, 2 historical-only checks skipped |
| CRM, configuration, users, branding and audit (`--crm`) | 136 passed, 2 historical-only checks skipped |
| Orders, quotations, receivables, reservations and catalog (default) | 61 passed |
| Teams and enquiry import (`--teams`) | 30 passed |
| Profile composition, migration policy contract and final linked-account regression (`--profiles`) | 21 passed |
| Policy/record-action/reference and notification unit checks | 10 passed |
| Existing CRM unit checks (`npm.cmd run test:crm`) | 60 passed |
| Production build, TypeScript and changed TS/TSX ESLint | Passed |
| Local real-Chrome flows (`--browser-only --access`) | 14 passed; screenshots inspected |

Generated previews and reports under `test-results`, `playwright-report` and
`tmp` are excluded from the application TypeScript build. Actual source and
tracked tests remain checked. A stale ignored preview exposed this boundary
after removal of an unused role prop; no compatibility prop was retained.

The migration rehearsal injects a failure immediately before commit and checks
complete rollback. The successful replay verifies 113 untouched tables exactly,
including memberships, owner IDs and assignments; it checks the reviewed policy,
custom-field and approval-route translations separately. All seven historical
user policies are converted and forced RLS is retained. This is synthetic-data
evidence, not a claim that a hosted pilot tenant has already been migrated.

Additional regressions cover read-all/edit-own, independent archive/assign limits,
owner handoff followed by immediate edit denial, active-only quotation templates,
source-order privacy for financial records, and revoked leave authority while a
review waits for the shared scheduling lock. Browser checks cover delegated Staff
profiles, read-only loading without directory access, project-team access, live
revocation, module activation, mobile policy controls and team report drill-down.

## Shared implementation

- `platform/access/catalog.ts`, `resource-policy.ts`, `rules.ts`: exhaustive
  resource registration, action vocabulary, supported/default scopes and strict
  permission-keyed validation. All 174 known permissions have defaults; missing
  entries on an existing policy deny access.
- `operation.ts`: current account, activation, composed profile permissions,
  record rules and team membership refreshed in the caller's transaction.
- `record-scope.ts`, `people-scope.ts` and owning module adapters: common record
  predicates. Read/action rules are intersected, not approximated by a hierarchy.
- `record-actions.ts`, `record-context.tsx`, `record-view.tsx`: server-calculated
  per-record action hints consumed by ordinary UI permission checks. Mutations
  independently reauthorize; UI hints never authorize a write.
- `reference.ts`: optional editor references can be omitted when their independent
  permission is denied, so Read does not require staff-directory or Edit access.
  The primary record and every write retain their normal authorization errors.
- Assignment and archive changes require their own grants and scoped predicates.
  Financial source reads cannot be widened by a broader target-module policy.
  Current leave authority is checked again after waiting for a scheduling lock.

Security administration remains Tenant Admin-only. Customer entrypoints,
employee/service eligibility, financial state transitions and approval routing
are domain invariants, not exceptions to business profile composition. Shared
reference records intentionally support All/None until they have real ownership.

## One-time migration

`20261025000300_resource_action_policies` follows pending migrations 108 and 109.
It translates each prior policy into ordinary resource/action rules, preserving
prior Staff/Manager ceilings, explicit project membership and team designation.
It also translates MANAGERS custom-field visibility to permission-controlled
PRIVILEGED visibility and persists the prior leave approval routing choice.
It then removes the old sales/project scope columns. Runtime code neither reads
old fields nor recognizes an old-policy mode. No tenant-specific override exists.

The frozen translation in `tests/helpers/resource-policy-data.cjs` is only a
historical regression oracle. It is not an application or migration dependency.
The SQL migration is the disposable conversion utility; no runtime conversion
script needs to remain installed.

## Release boundary

Local fixture rehearsal is not proof of a real pilot database's current contents.
Before hosted staging: verify its identity, take and restore-test a fresh backup,
apply migrations 108–110 and deploy matching code in one controlled cutover.
Compare user/profile rules, team/project membership, owners and representative
staff-visible records before/after. Old code cannot run against the new schema.
Use the tested recovery process if any comparison differs.

Production remains untouched by this work and needs its own verified backup,
pilot visibility comparison and authorized release window. Do not copy fixture
profiles, seed/reset data or test accounts into an onboarded tenant's database.
