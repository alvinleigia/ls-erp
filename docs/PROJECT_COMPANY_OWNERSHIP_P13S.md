# P13S: explicit company ownership and pilot reassignment

Status: local implementation; production data has not been reassigned.

Projects, enquiries and opportunities now display their saved owning company and
office. New independent projects and sales forms expose the shared creation-office
chooser beside their details. Choosing another company/office explicitly updates
the preference and recaptures this form's expectation without discarding its draft.
Other forms retain their original expectation and stale saves still fail. A phase
inherits its parent's office; conversion inherits the enquiry's office. Ordinary
editing cannot transfer saved records.

The existing Developer account field identifies a CRM party, not the issuing legal
company. Employment workplace placement is also separate from sales access and is
not changed by this increment. Company hierarchy remains optional.

## Shared presentation and authority

Migration `20261118000100_record_office_labels` adds one read-only metadata function
and changes no records, modules, profiles, grants or existing native functions.
`app.record_office_label` checks the authenticated tenant/actor and current office
eligibility. It returns only office/company labels and active state, including
authorized closed-office history. It does not grant company-directory access or
business-record access. Modules authorize their source before calling the shared
adapter. The labels are read-model fields, not new ownership input fields or
changes to sales snapshots/audits.

`RecordOfficeFields`, `CreationOfficeFields` and `useCreationOfficeContext` are
industry-neutral. Existing callers of `useCreationOfficeSnapshot` retain the same
headers contract. The creation selector is not a report filter or a saved-record
transfer mechanism.

## Offline reassignment utility

`scripts/project-company-migration.cjs` is not part of the application runtime.
It supports a complete reviewed mapping of top-level project codes to company and
office codes. Phases inherit their mapped parent. It resolves enquiry/opportunity
contexts, imported enquiry batches, activities and follow-up ancestry together.
Cross-company source conflicts, mixed-company batches, unfinished affected import
rows, unknown sources, stale source digests and incomplete access review stop the
operation. Enquiries with no project and independent contact activities retain
their current office unless source ancestry requires otherwise.

This first utility is intentionally pre-commercial: quotations, orders, project
units or activity-plan launches require a separately reviewed migration. It never
rewrites frozen documents or invents company-specific customer/KYC copies.

The rehearsal writer accepts only dedicated loopback rehearsal databases, not
hosted databases or the everyday local demo. The separate offline production
entry point requires the registered production database and migration identity,
verified TLS, the reviewed tenant/source digest, a verified recovery backup and
copy rehearsal, disabled runtime logins and zero remaining runtime sessions.
There is no web route for reassignment. The native ownership guard still rejects
ordinary office updates, including privileged direct updates.

### Preservation checks

- Capture every active user's actual application Read/Edit/Assign/Archive/Export
  populations through current authorization, record scopes and the runtime DB role.
- Derive the additional office grants needed by existing authorized readers,
  responsible users, project members and affected import operators. Preserve old
  grants, profile rules, teams, reporting relationships and creation preferences.
- In one transaction, lock every table covered by preservation checks, recheck the source
  digest, add audited grants and move only the reviewed roots. Increment source
  versions to reject already-open stale editors.
- Transactional DDL suspends only the identified native office-immutability
  triggers on changed roots under exclusive locks in the isolated copy. Drain
  deferred constraints, recheck source convergence and restore the guards before
  commit. Failure rolls back data, grants, audits and the DDL together. There is no
  runtime bypass flag, new role fallback or tenant-specific application branch.
- Compare fingerprints of every public table. Changed root rows may differ only
  in office/version/update timestamp; old audits, customers, correspondence,
  evidence, submissions, profiles and unrelated tenants remain untouched. Only
  the reviewed office grants/policy versions and new migration audit events are
  additional changes.
- Compare application populations after the rehearsal. Keep old office grants
  and original audit facts; historical office references are not rewritten.

Project-wise accounting within one legal company does not require extra companies.
This change establishes ownership; it does not implement a project expense ledger
or group financial consolidation. GST registrations, document templates and bank
settings still need to be configured for each issuing company before use.

## Verification

```powershell
npm.cmd run test:project-company-migration
npm.cmd run test:workspace-office-ui
npm.cmd run test:workspace-office-ui:browser
npm.cmd run build
```

The first command owns a fresh disposable Docker database and never loads hosted
credentials. Tests cover complete source movement, own-record/Restricted scopes,
stale plans, incomplete access review, mixed imports, commercial blockers, forced
rollback, unchanged shared customers and restoration of native guards. Browser
checks cover explicit company selection, retained drafts, inherited phase
ownership, stale tabs, archived offices and missing/revoked access. Inspect the
desktop/mobile screenshots before reporting visual acceptance.

The protected Ewissen-copy rehearsal, its mapping, user-ID access populations and
backup references are kept in ignored private evidence, outside source control.
Successful synthetic checks are not a substitute for the copied-pilot comparison.
A live cutover requires a fresh verified backup, a write pause, a newly reviewed
plan and the production release process. The earlier read-only count preview is
not an executable migration authorization or a permanently valid row count.

### Local acceptance (2026-11-18)

- 56 native office/access/workspace checks; nine isolated reassignment checks;
  61 CRM unit checks; seven real browser scenarios passed.
- TypeScript, targeted lint and production build passed. Desktop and mobile
  project-detail captures were inspected; saved ownership sits inside the
  existing details and there is no horizontal page overflow.
- The local demo was brought up to 160 migrations without a reset or reseed.
  This included two previously pending safeguard migrations and the new
  read-only office-label function.
- No hosted schema, company grants, assignments or business records have been
  changed by this work. Production and hosted staging verification remain a
  separate release step.

The hosted acceptance test exposed React portal submit bubbling from the office
chooser into its enclosing project form. Shared edit panels now stop submit
propagation; regression checks require zero project POSTs when applying the office
and exactly one POST after explicitly saving the project. Existing page drafts,
office expectation checks and phase inheritance remain unchanged.

Hosted staging acceptance passed on `d3053ed`; desktop/mobile screenshots were
inspected. Migration 160 preserved all prior staging rows. The reassignment suite
uses disposable SCRAM-authenticated PostgreSQL, including the scoped reader pool,
so trust-only local authentication cannot conceal a missing connection password.
These release-runner corrections do not change application record-access rules.
Maintenance verification retains one authenticated read-only session for the
actual runtime role while new logins are blocked, captures all actor scopes, then
closes that verifier before the writer runs. The new regression test proves this
with NOLOGIN enforced and rejects a separate new connection. No temporary role
membership is granted to the database operator.

### Protected Ewissen-copy acceptance (2026-11-18)

A fresh encrypted, read-only production backup was restored without an application
server, published ports or external network access. All 180 public-table
fingerprints, role attributes, owners and ACLs matched; 16 stored objects and their
16 saved references were verified. The copy then exercised forced full rollback
and successful reassignment. Its disposable database was removed afterward.

The reviewed mapping is:

| Company | Projects |
| --- | --- |
| Blockbuildtech LLP | Altura, Deepwood harmony, Dodamarg Heights, Latex Valley |
| Ewissen Greenfield | Shaashvat Aranya |
| Ewissen Infrastructure | Bliss abode, Bliss Aqua, Bliss Farms |

Ewissen Infra LLP and HR/workplace data remain unchanged. Shared-GST projects
within Blockbuildtech remain separate projects of that one legal company.

The copied plan moved five projects, 26 enquiries, 19 opportunities, nine activities
and one import batch. It required ten additional office grants across six users;
existing grants and access profiles were retained. All 3,072 enquiries were
preserved, including the eight without a project, which stayed in their current
office. These are backup-time counts, not a permanent live migration plan.

Every active user's actual application Read/Edit/Assign/Archive/Export ID sets
matched exactly before and after. Native comparisons covered 140 tenant-scoped
tables for all eight users; private/KYC and unrelated access matched exactly.
Thirty-eight broad sales/history table populations narrowed under office isolation;
these are user/table comparisons, not deleted records. Source-office eligibility
was verified for every user and destination offices were operationally empty, so
additional office grants could not reveal unrelated destination data. Application
record scopes remained exact; original audit facts were preserved.

The successful receipt and source/grant details are ignored private evidence. This
is acceptance on a restored copy, not a production data migration or deployment.
