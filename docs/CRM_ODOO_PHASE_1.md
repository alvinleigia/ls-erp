# Odoo alignment Phase 1: CRM extension boundary

Updated: 2026-09-29. Implemented and verified locally. Not deployed in this step.
No database schema change or migration is required.

## User-visible changes

Open **CRM > Configuration** for Pipelines, Lead sources, Lost reasons, Activity
types, Activity plans and Follow-up rules. These are grouped into Sales process
and Activities and follow-ups. Sidebar and CRM navigation use this entry point;
existing settings URLs remain valid and highlight Configuration. Existing
server-side permissions continue to control changes to each setting.

Project fields, list captions, filters and pipeline drafts retain their existing
behavior. Configurable project catalogs, additional fields and sales teams are
later phases, not features delivered by this change.

## Ownership and composition

- `modules/crm/extensions.ts` defines transaction-bound operations for splitting
  extension input, saving, copying during conversion, decorating paginated records,
  query filters, report joins/projections and choice lists.
- `modules/crm/service.ts` accepts the extension through its constructor. Its
  default implementation performs no industry lookups and rejects unavailable
  project filters. Core validation remains strict and industry-independent.
- `modules/real-estate/crm-extension.ts` implements these operations using existing
  property validation and persistence. It checks tenant module state inside the
  caller's transaction; it does not cache state across requests or tenants.
- `application/crm/service.ts` installs the Real Estate implementation.
  `application/crm/http.ts` is the authenticated HTTP composition point used by
  CRM routes. Future non-HTTP adapters should choose the same application factory
  when they need installed industry functionality.
- The shared React extension provider owns an opaque draft and rendering slots.
  Real Estate owns its fields, serialization, captions and filter controls.
  `application/crm/provider.tsx` installs those views in the CRM layout. Pipeline
  drafts and optional navigation links are supplied by application pages/layout.

Core CRM has no direct imports of Real Estate implementations or application
composition. Real Estate depends on narrow CRM contracts and policy helpers.
This is constructor/context injection for actual integrations, not a runtime
plugin framework or a re-export that conceals the previous dependency.

## Compatibility and safety

Existing HTTP URLs and response fields are retained, including `propertyContext`,
`realEstateEnabled`, project query parameters and report projection columns. These
remain compatibility DTOs; Phase 1 does not introduce a universal reporting or
custom-field schema. Internal service consumers needing installed extensions now
use `createApplicationCrmService`; generic core tests use `createCrmService`.

Extension writes and required audits use the same transaction as the CRM write.
Conversion copies saved context even while Real Estate is disabled. Omitted
extension input preserves context; explicit clearing still requires access to
the enabled module. Existing record scope, RLS, composite foreign keys, optimistic
versions, audit rollback and idempotent conversion remain intact.

## Query behavior

- Read decoration uses one tenant-module lookup and at most one context query for
  the whole page. Empty pages no longer repeat the module lookup for metadata.
- A map attaches contexts in linear time rather than repeatedly searching the
  context array for each record. Page-size and export bounds are unchanged.
- When Real Estate is disabled, sales-report SQL has no property-context/project
  joins. Enabled report joins remain one-to-one and tenant-qualified, and filter
  values remain bound SQL parameters.
- Existing server pagination, scoped predicates, report reconciliation and
  database indexes are preserved. No scale-latency claim is made from these
  regression checks; this phase changes no indexes or storage design.

## Verification

All database writes for verification used disposable PostgreSQL on localhost,
database `ls_salon_crm_test`, with a non-bypass application role and tenant RLS.
The hosted business database and its existing testing leads were not modified.

- 24 unit/boundary tests passed: existing 19 plus five extension checks. Checks
  cover independent core loading, import boundaries, strict validation, conversion
  input, bounded decoration queries and module-off/parameterized report SQL.
- CRM integration: 70 passed; two historical migration-fixture checks skipped.
- Sales reporting integration: nine passed, including counts/drill-down/export
  reconciliation, scope and module-off behavior.
- Real Estate integration: 15 passed; one historical migration-fixture check
  skipped. Covers project permissions, context, conversion, archive preservation,
  RLS and rollback on failed required audit.
- Six browser scenarios passed across configuration, sales reports and project
  sales. Covered actual API-backed project intake/conversion, activity completion,
  won opportunity, filters, CSV, module-off edits and archived selections. The
  Configuration desktop/mobile screenshots and opportunity mobile screenshot
  were inspected. Configuration navigation fits a 390px viewport.
- TypeScript, targeted ESLint and the production build passed. The restricted
  build initially could not download Google Fonts; rerunning with network access
  completed successfully without code changes for that environment restriction.

Two older tests were updated to the already-delivered behavior: lost opportunities
select a managed lost reason, and the activity picker uses its searchable Meeting
option. No permission or validation assertion was relaxed.

## Release and recovery

Deploy the application code together; no migration or data backfill accompanies
it. Old application code can still read/write the unchanged schema. After release,
verify the existing CRM Test leads and permissions read-only against the hosted
version. Local browser results do not prove deployment or hosted feature presence.

Next: [Phase 2 in the active plan](CRM_ODOO_ALIGNMENT_PLAN.md#phase-2--configurable-project-choices).
