# Phase 3 — Optional projects for sales

Implemented and verified locally on 2026-09-28. Not deployed; the hosted database
has not been migrated. Phase 4 project links on enquiries/opportunities remain pending.

## Delivered

- Optional `realEstate` business module, disabled by default, requiring `crm`.
  Active business administrators enable/disable it in Settings → Modules.
  CRM cannot be disabled while Real Estate is enabled. Both flags are checked
  inside the audited serializable transaction; competing switches contend on
  the CRM flag and retry before applying a stale dependency decision.
- Projects navigation at `/crm/projects`, hidden when the extension is disabled.
  Direct page and API access also checks enablement. Disabling preserves records.
- Project name, unique code, optional developer business account, location,
  description, property categories, indicative min/max price and currency,
  sales lifecycle, archive state and responsible staff assignments.
- A project can have one level of subprojects. Use **New subproject** from its
  parent to select the relationship. Parent identity cannot be changed later.
  Codes are uppercase and unique across both levels within a business, including
  archived records. No arbitrary-depth hierarchy or unit inventory is introduced.
- ADMIN/MANAGER users administer projects and membership. STAFF users can read
  their assigned active projects and active subprojects. Subprojects inherit
  parent membership. Membership does not grant customer, account or deal access;
  otherwise-private developer identifiers/names are masked.
- Archiving a parent hides it and its children from staff without changing each
  child's archive flag. Restoring a parent restores access only to active children.
  New children and child restoration require an active parent. Staff assignments
  are retained; only active top-level projects accept membership changes.
- Shared CRM cards, shadcn dropdowns, searchable server selectors, header
  Save/Cancel actions, archive/removal confirmations, DataTable and pagination.
  Search covers name/code/location with lifecycle and archive filters. Lists and
  membership lists are server-paginated. Failed detail loads show no blank editor.

Sales lifecycle choices are Planning, Pre-launch, Selling, On hold and Closed.
Property categories are Apartment, Villa, Plot, Office, Retail, Industrial,
Mixed use and Other. These initial extension-owned choices describe marketing
context, not availability, reservations or a generic custom-field engine.

## Ownership and migration

`modules/real-estate/` owns validation, service operations and screens.
`platform/module-service.ts` owns module dependency changes. Thin APIs are under
`/api/real-estate/projects`, including detail and paginated member routes.

Migration `20260928160000_real_estate_projects` adds `RealEstateProject` (a nullable
parent distinguishes subprojects) and `RealEstateProjectMember`. Both enforce
tenant RLS; composite foreign keys constrain parents, developers and staff to the
same tenant. Database checks protect codes, lifecycle, prices, currency and version.
There are no destructive schema changes or changes to existing CRM identifiers.
Every project/membership mutation writes a required audit in the same transaction.
Edits and membership changes require the current project version.

Apply migrations in order, including Phase 2, before releasing the application.
Use the normal migration connection; runtime callers continue through the shared
tenant adapter. Enable CRM, then Real Estate per business after migration. No
tenant is automatically enabled and no project data is seeded into hosted tenants.

## Verification

- Actual additive migration from a snapshot of the Phase 2 schema, with synthetic
  existing contacts, enquiries and a converted opportunity. IDs, source text,
  versions, dates and deal relationships/amounts remain unchanged.
- Eight project integration tests pass using the production tenant adapter and
  non-bypass application roles: hierarchy, tenant FKs/RLS, membership and private
  developer masking, current role/status checks, archive/restore, stale edits,
  audit rollback, pagination and concurrent module dependencies. Test pools close.
- Existing CRM integration suite: 62 pass, two older upgrade-fixture tests skipped
  because this run starts at Phase 2. Those earlier migrations were verified in
  their own phases. Nineteen existing unit tests pass.
- Seventeen existing CRM browser regression checks pass. Three new opt-in local
  browser tests pass: real project/subproject/membership/archive writes, staff
  read-only/error presentation, and module-off behavior with CRM still accessible.
  Desktop/mobile screenshots were inspected; mobile has no document overflow.
- TypeScript, targeted ESLint and production build pass.

Integration command: `npm.cmd run test:real-estate:integration`, with
`CRM_TEST_DATABASE_URL` restricted to a disposable local `ls_salon_crm_test` database.
The upgrade assertion additionally requires `CRM_TEST_EXPECT_PROJECT_UPGRADE=1`
and the synthetic intake upgrade fixture. Prepare from the Phase 2 schema using
`scripts/prepare-crm-test-db.cjs` and
`CRM_TEST_FROM_MIGRATION=20260928160000_real_estate_projects`.

Browser writes require both `CRM_BROWSER_LOCAL_WRITES=1` and the exact local
fixture origin `http://intake-upgrade-a.localhost:3001`. They are skipped by default
and on hosted targets. Login state and visual artifacts remain ignored locally.

## Next phase

Phase 4 adds explicit project/subproject links to enquiries and opportunities,
preserves them at conversion, and adds project-related sales context, filters,
actions and the property sales pipeline. Payments, documents/KYC, bookings,
reservations, unit inventory and commissions remain outside this release.
