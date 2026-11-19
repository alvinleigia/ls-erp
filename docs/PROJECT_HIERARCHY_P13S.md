# P13S — Multi-level project hierarchy

## Behaviour

Projects can contain child projects at successive levels. The same record model
is used at every level; there are no fixed Sector, Block, Wing or Floor tables.
Names describe the builder's structure. A unit belongs to one selected node.
The project directory has a paged List and a lazy Hierarchy view. All levels search
finds nested records without expanding the tree. Each record
provides breadcrumbs and its own Subprojects tab for navigating or adding children.
Selectors display full paths and search descendants within the selected root.

Company/office, membership, responsible team and selected-user/team sharing
continue to inherit from the top-level project. A hierarchy relationship never
grants a missing profile action or access to linked sales. No existing assignment,
role, sharing grant or office membership is changed by the migration. Assigned
readers cannot browse a branch with an archived ancestor. Administrators retain
their normal historical browsing capability. New project/context selections and child creation
require an active ancestry; restoring an ancestor does not unarchive its children.

Enquiries and opportunities retain their existing root `projectId` and optional
`subprojectId`, which can now identify a descendant at any depth. Conversion copies
the same IDs. Branch filters include matching descendants once, within the user's
sales/work scope. Directory permissions are not prerequisites for matching an
already readable sales source. Project unit filters include the node and its
descendants. These behaviours use native scopes and server-side paging.

New quotation property evidence freezes the full path. Existing accepted evidence
and issued PDFs are not rewritten. New letters still verify current source access,
property facts, active ancestry and the existing hold/allocation requirements.
Historic evidence without a saved full path retains its recorded facts; the system
does not reconstruct a historical path from current names.

## Native implementation

The parent relationship is canonical and immutable in ordinary writes. Migration
`20261119000100_project_hierarchy` backfills `rootId` and a read-only ancestry index:

- `RealEstateProjectAncestor`: indexed ancestor/descendant links and distance,
  including the node itself. Supports subtree matching and ancestor state checks.


Native triggers derive root and indexes atomically when creating a node. Parents
must exist in the same tenant. Reparenting, identity changes and direct index writes
are rejected. Existing native office guards keep every branch in its saved office.
Cycles cannot be introduced through creation or ordinary updates. A future move
requires a separately reviewed operation with source, access and snapshot checks.

Metadata uses forced tenant/office/sharing RLS. Names are resolved separately through
ordinary project RLS. Root action/record policies remain the outer access boundary;
sales, financial and document records retain their independent authority.

## Verification and release

`npm.cmd run test:project-hierarchy` uses a disposable local database and includes
a forced migration rollback, full prior-table preservation and native regression
checks. `npm.cmd run test:project-hierarchy:browser` adds real application browser
checks with synthetic identities. No hosted database or saved client login is used.
Office isolation checks use their separate fixture mode, without automatic test
office grants. Commercial document, reservation and quotation tests cover the
affected source consumers.

The application requires this migration before deployment. Staging can apply it
through the existing guarded workflow. Production requires the controlled release,
fresh backup and pilot access-preservation verification. This implementation does
not reassign Ewissen projects or reinterpret any existing subproject as a phase.

### Verified locally, 2026-11-19

- Final hierarchy/CRM/catalog/sharing suite: 61 passed; two historical-only cases
  were not selected. The historical migration rehearsals ran separately.
- Quotation/order/reservation/receivable/document regressions: 83 passed.
- Native office isolation without automatic fixture grants: 27 passed.
- Real browser flows: two passed, including creation below the fifth level,
  company inheritance, full breadcrumbs and lazy hierarchy expansion. Desktop,
  mobile and tree screenshots were inspected; no horizontal overflow/page errors.
- Production build/TypeScript, targeted ESLint and whitespace checks passed.
- Migration rollback and all 179 preceding tables were compared before/after,
  excluding only the newly derived root field. The local demo now has 161 applied
  migrations. Staging/production have not been changed or deployed.

Evidence is retained locally in `tmp/project-hierarchy-*.log`,
`tmp/industry-release/ls-erp-sales-orders-3289c689d57d.log` (final native rehearsal),
`tmp/industry-release/ls-erp-sales-orders-7336e98848a7.log` (office isolation), and
`test-results/project-hierarchy-{desktop,mobile,tree}.png`.

## Separate next increment

Launch phases remain separate from structural child projects. The subsequent
local increment adds explicit unit phase assignment and prospective reservation
controls; see `PROJECT_LAUNCH_PHASES_P13S.md`. Neither migration infers phases from
existing structural names or fabricates bookings.
