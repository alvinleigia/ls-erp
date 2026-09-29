# CRM Odoo alignment: Phase 2

Implemented locally on 2026-09-29. Not committed, pushed, deployed or migrated on
the hosted database by this phase. Phase 1 remains a prerequisite. Additional
fields and sales teams are still separate future phases.

## Configuration

With CRM and Real Estate enabled, open **CRM > Configuration > Real Estate**:

- **Project statuses**: choices for the project's Sales lifecycle field.
- **Property categories**: one catalog shared by project categories and buyer
  preferences on enquiries/opportunities.
- **Buying timeframes**: buyer timing choices on enquiries/opportunities.

Administrators/managers can add, rename, order, set a default, archive and restore
choices. Staff can read/select them but cannot configure them. Lower order numbers
appear first; ties use name and stable ID. Names are unique within each tenant's
catalog, including archived entries. Default selection replaces the prior default
atomically. Archiving a default in the UI clears it after confirmation.

New forms and API creations use defaults when the relevant choices are omitted.
Explicit empty buyer choices or an empty project-category array remain empty.
Existing selections are preserved on partial edits. A new project needs a selected
status or a configured default; optional categories/timeframes need no default.

Searchable selectors use bounded server requests (20 results and a refinement
prompt). Configuration lists support search, active/archive filters and server
pagination. Forms use shared CRM sections, header Save/Cancel controls and archive
confirmation. The mobile list retains the standard count and pagination controls.

Project status labels do not archive projects, change stock availability, or move
sales opportunities. Opportunity stages and active/archive state remain separate.

## Data and query behavior

- Three typed, tenant-owned catalogs with composite foreign keys, forced RLS,
  optimistic versions and required transactional audit events.
- Existing string fields remain stable IDs. Seed IDs retain the old codes such as
  `SELLING`, `APARTMENT` and `WITHIN_3_MONTHS`; custom choices use generated IDs.
- Selected labels are snapshotted on projects and buyer contexts. Renaming or
  archiving does not rewrite these snapshots. Conversion copies the original
  buyer labels, including when Real Estate is disabled.
- Project category arrays remain compatible with existing callers. A database
  trigger maintains `RealEstateProjectCategory`, whose tenant/project/category
  foreign keys validate every selected ID. This projection also supports indexed
  category relationships without making JSON the business-data authority.
- Active options are required for new assignments. Unchanged archived selections
  can be saved, cleared or converted. An archived option cannot be assigned to a
  different record. Restoring it makes it selectable again.
- Catalog pages execute one bounded list and one count query after actor/module
  authorization. They do not fetch all choices or query once per result. Project
  category validation uses one batch lookup, with at most 50 selected categories.
- Defaults use three bounded queries, one per typed catalog. An indexed partial
  unique constraint permits only one default per catalog and tenant.
- A driver-adapter constraint-field fallback was corrected in CRM's conflict
  handling so concurrent enquiry conversion can identify the unique enquiry link
  even when Prisma supplies an empty legacy target array.

## Migration and recovery

Migration: `20260929090000_real_estate_choices`.

It adds catalogs, label snapshots, the category projection and tenant constraints;
seeds equivalent choices for existing tenants; backfills labels/relationships;
and replaces fixed-choice checks with foreign keys. Financial and hierarchy checks
remain. Tenant provisioning seeds the same initial choices using an invoker-rights
trigger; tenant RLS still applies. Existing IDs, versions, timestamps, CRM counts,
project memberships and enquiry/opportunity links are not rewritten.

Before hosted release:

1. Back up the database and capture the existing CRM Test projects, contexts,
   versions/timestamps, links and relevant report counts read-only.
2. Release/verify Phase 1 first. Apply this migration through `prisma migrate
   deploy` using the approved migration connection, then deploy Phase 2 together.
3. Reconcile project/category arrays against the category relation, check that
   every status/category/timeframe has a same-tenant catalog row, and compare the
   saved baseline. Verify existing CRM Test leads, permissions and conversion
   through the hosted application. Local results are not hosted verification.

The migration runs in one transaction and validates the added foreign keys. An
unexpected legacy value causes a rollback rather than discarding it; investigate
and map it deliberately before retrying. No seed/reset script should target hosted
data. New choice creation should remain unavailable until the new app is ready.

Keep the added schema if an application rollback is needed. Old fixed-enum builds
cannot edit custom choices introduced after release. After custom choices exist,
use a compatible rollback build/forward fix; do not drop catalogs or silently map
custom values back to old enums. A database restore requires the captured backup
and a plan for writes made after it.

## Local verification

Disposable PostgreSQL 16 database `ls_salon_crm_test`, with the normal non-bypass
runtime role. No hosted fixture/reset/migration was run.

- Applied the real incremental migration to the pre-phase schema with synthetic
  existing enquiries, a converted opportunity, parent/child projects, membership
  and buyer requirements. Reconciled choices, IDs, versions, dates, budget and
  links. Prisma's schema comparison reports an empty migration afterward.
- CRM unit/boundary suite: **24 passed**.
- CRM integration: **70 passed**, two older migration-fixture checks skipped.
- Sales/report integration: **9 passed**.
- Real Estate integration: **24 passed**, one older migration-fixture check
  skipped. Includes this phase's actual upgrade fixture, defaults, explicit
  clearing, partial updates, manager/module permissions, cross-tenant and
  wrong-catalog FKs, archive/rename history, concurrent writes and audit rollback.
- Browser: **six scenarios passed** across CRM Configuration, new catalogs and
  project sales. The two catalog scenarios were rerun after strengthening loaded
  list/search assertions. Inspected desktop and 390px mobile form/list screenshots.
- Changed-source ESLint and TypeScript passed. Unscoped `npm run lint` also scans
  old ignored test artifacts and is not a clean repository-wide check.
- Production build passed. The first restricted attempt could not download Google
  Fonts; the retry with network access completed without changing font code.
- Fresh-schema preparation and catalog permissions also passed in a second
  disposable database, separately from the incremental upgrade test.

Measured catalog fixture: **10,009 choices**, 20 returned per page, approximately
**60 ms** for the authorized list/count service and **0.185 ms** for the ordered
index query under local concurrent browser testing. `EXPLAIN ANALYZE` confirmed
an index scan. This is a local measurement, not a hosted latency guarantee or a
benchmark of every CRM query; text search still filters within the tenant catalog.

For repeatable migration tests, generate SQL from the pre-phase Prisma schema,
concatenate `tests/fixtures/crm-intake-before.sql` and
`tests/fixtures/real-estate-before-choices.sql`, and run
`scripts/prepare-crm-test-db.cjs` on an **empty disposable local** database with
`CRM_TEST_BASE_SQL`, `CRM_TEST_BASE_DATA_SQL` and
`CRM_TEST_FROM_MIGRATION=20260929090000_real_estate_choices`. Then run
`npm run test:real-estate:integration` with `CRM_TEST_EXPECT_CHOICES_UPGRADE=1`.
The preparation script rejects remote hosts, another database name or a nonempty
database. Browser writes additionally require `CRM_BROWSER_LOCAL_WRITES=1` and
the isolated `intake-upgrade-a.localhost:3001` target.
