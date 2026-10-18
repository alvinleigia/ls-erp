# Industry-neutral refactor: R1 audit and delivery plan

Date: 2026-10-16. Source baseline: `5f13238` on `main`.
Status: R1, R2(a-d), R3 and R4 complete locally. R5 verified client restore, historical checksums, release migrations and Vercel baseline. All 84 service comparisons, 90 module/access assertions, a fresh production build, 58 browser workflows and 98 historical/integration tests passed. Additional populated-query suites passed 41 tests, and source-default-grant/ICU compatibility checks passed with nine terminology tests. Project-local encrypted backup integrity/decryption pass. Next: controlled write-freeze/cutover preparation and an agreed window with a fresh backup. Recovery remains tied to this Windows account; exact ICU version and complete private environment recovery are not reproduced locally. Existing Vercel settings must be retained.
See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md) for the current checkpoint.
See [R3 delivery notes](INDUSTRY_NEUTRAL_R3.md) for custom-field ownership, terminology coverage and verification.
See [R4 delivery notes](INDUSTRY_NEUTRAL_R4.md) for the current isolation checkpoint and remaining work.
See [R5 delivery notes](INDUSTRY_NEUTRAL_R5.md) for backup scope, restore evidence and unresolved release blockers.
R5 cutover preparation: seven freeze/drain/reopen tests and an in-place client-copy
data rollback passed. See [the cutover runbook](INDUSTRY_NEUTRAL_CUTOVER.md).
Ownership/ACL recovery also passes with a non-superuser operator while preserving
managed schemas/defaults. Next: agreed maintenance window, final target checks and
fresh backup before migration/deployment. Execution-time pooler checks still apply.

This plan supersedes earlier forward-looking refactor proposals, not their
historical release evidence. Production remains on its current release until R5.
R1 inspected source, schema, migration history files and tests; it did not connect
to production, inspect client records, take a backup or verify hosted migrations.
No client data, credentials or database dumps belong in this document.

## Objective and limits

Make the existing product usable across industries, with Real Estate installed
through explicit extension points. Preserve Ewissen's data and effective access.
Deliver one final runtime implementation, not old/new service branches, dual
writes, duplicated forms or permanent schema translation adapters.

No new modules, property units, reservation engine, accounting, collections,
team-sharing access scope, automotive preset or external plugin loader in R1-R5.
Industry-neutral does not mean removing useful domain concepts: appointments
still schedule services, inventory still tracks quantities, and projects remain
Real Estate records. Neither renaming a field nor a custom field can substitute
for booking, financial, authorization or relational integrity rules.

## Evidence and file-level work map

Paths below identify existing files unless marked **proposed**. Move behaviour
with its tests; remove replaced implementations in the same change.

| Area | Current evidence | Planned change / phase |
| --- | --- | --- |
| Module activation | `platform/modules.ts`, `platform/module-service.ts`, `platform/module-server.ts` already separate allowance, tenant activation and dependencies. Contacts and Activities are CRM capabilities, not separate activation modules. | Retain module keys and current dependency graph. Clean stale salon commentary. Do not introduce new switches or silently enable anything. R2. |
| CRM composition | `application/crm/service.ts` injects Real Estate and quotations; `application/crm/provider.tsx` installs views. Core has no direct industry implementation import. | Keep application-owned composition. Register explicit capabilities using typed contracts, not a dynamically loaded plugin system. R2/R4. |
| CRM contracts and queries | `modules/crm/extensions.ts`, `validation.ts`, `sales-report-validation.ts` still define project/subproject filters and `realEstateEnabled`; the empty report includes property columns. | Extension-owned validated filters, report dimensions and projection descriptors. Core owns paging, access scopes and common measures. Module-off core needs no property columns or joins. R2. |
| Reports and exports | `modules/crm/sales-report-service.ts`, `components/sales-reports.tsx`, `app/api/crm/enquiries/export/route.ts`, `app/api/crm/opportunities/export/route.ts` branch on property fields. | Supply columns/dimensions from the extension; move CSV construction out of transport routes into the owning services. Keep reconciliation, exact amounts and parameterized SQL. R2. |
| Record views | `modules/crm/components/record-list.tsx`, `opportunity-views.tsx`, `enquiry-editor.tsx`, `opportunity-editor.tsx`, `work-list.tsx`, `extension-provider.tsx` contain fixed project props/filter state or property instructions. | Use typed extension state and slots; Real Estate owns project initialization, filtering and help text. Keep record-level tabs, lazy mounting and pagination. R2/R4. |
| Import | `modules/crm/import-service.ts`, `import-types.ts`, `components/enquiry-import.tsx` have project/subproject-specific matching, default selection and reset logic. | Describe dependent choices/default eligibility in field metadata; validate the relation in the extension. Keep a single parser, duplicate policy, correction download and resumable transaction flow. R2/R4. |
| Dashboard | `platform/dashboard/sales-summary.ts` directly imports CRM and Real Estate; `components/dashboard/sales-widgets.tsx`, `types/dashboard.ts` combine all sections. | Move domain queries/widgets to their modules; **proposed** `application/dashboard/` composes enabled, permitted sections. Platform supplies neutral shared helpers only. Preserve definitions, counts, currencies and drill-down scopes. R2/R4. |
| Sales Documents | `modules/sales-documents/quotation-service.ts` is separate and uses `quotationContext`, but depends on the broad `CrmServiceContext`/`CrmExtensions` types. Calculation and snapshots are already industry-neutral. | Narrow the contract to required opportunity access, transaction/audit and document context providers. Keep the legitimate CRM dependency and optional Payment Plans. Do not invent standalone sales orders. R2. |
| Custom fields | `platform/custom-fields/{resources,service,validation,values}.ts` supports typed values and prospective `requiredSince`, but service access requires CRM and has sales-team-specific lookups. `application/crm/custom-fields.ts` registers three resources. | Move registration to **proposed** `application/custom-fields.ts`; resource descriptors supply module/permission and contextual scope validation. Keep existing typed value tables, IDs and required cohorts. Extract shared form controls from `modules/crm/components/custom-fields.tsx` where reusable. Do not add custom-field tables to every module merely for completeness. R3. |
| Labels | Core labels are literals in forms, navigation, exports and permissions; no shared tenant terminology resolver was found in audited paths. | **Proposed** `platform/terminology/` supplies an allowlisted catalog of stable resource/field keys and tenant overrides. Apply consistently to current screens and data exchange, with Real Estate contributing only its own keys. R3. |
| Shared UI | `components/erp/*` already owns neutral components; CRM files such as `crm-record-detail.tsx` mix simple re-exports with meaningful permission filtering. | Migrate pure aliases to direct shared imports and remove dead aliases after all consumers move. Preserve meaningful permission-aware behaviour in an explicitly named component. Do not duplicate UI or delete authorization with a wrapper. R2. |
| Platform dependency direction | `platform/access/service.ts` imports CRM database error helpers; `platform/access/routes.ts` imports CRM configuration. | Move truly generic DB error handling to a shared platform helper. Register route metadata at application composition; platform evaluates it without importing module UI/configuration. R2. |
| Operational modules | `modules/{inventory,services,appointments,workforce}/api.ts` enforce activation/access, while domain logic also lives in `app/api/` and booking helpers under `app/api/appointments/orders/`. | Extract reusable rules into owning module services and keep routes as HTTP adapters. Prioritize stock adjustments, pricing, availability and leave/shift rules; preserve transaction boundaries and action gates. Shared does not mean merging service appointments with CRM activities or quotations with invoices. R2, in separate tested batches. |
| Remaining terminology | Tenant/organization screens still say salon; seed routes include existing `ls-salon.test` identities. | Replace user-facing salon wording with business/tenant wording. Do not rename actual user emails, hosts, IDs or historical audit text by search-and-replace. R2/R3. |

## Final ownership and contract decisions

- `platform/`: tenancy, permissions, activation, generic validation/configuration,
  auditing, localization and shared infrastructure. No business-module imports.
- `components/erp/`: neutral presentation only; callers provide permitted actions.
- `modules/crm/`: contacts/accounts, enquiries, opportunities, sales teams,
  activities and common reports. These can remain in one module without being
  industry-specific. No compulsory folder split into new modules.
- `modules/sales-documents/`: quotation content, calculation, immutable revisions,
  PDF rendering and optional instalment schedules.
- `modules/real-estate/`: projects/subprojects, membership, property choices,
  buyer context, presets, filters and industry contributions to shared screens.
- Other existing modules own their operational rules, independent of Real Estate.
- `application/`: installs module providers, route metadata, navigation and
  dashboard contributions. Cross-module coordination is explicit here.
- `app/`: route/page adapters. Existing URLs may remain canonical; retaining a
  working URL is not maintaining two implementations.

Use the smallest explicit contract for each existing integration: validated
filter input, editor state, report projection/dimension, import field metadata,
document context and dashboard section. Descriptors are code-owned allowlists;
tenant input must never select SQL identifiers or executable implementations.
Keep all query contributions within the caller's tenant transaction and record
scope; extensions cannot broaden access.

## Configuration behaviour (R3)

1. Core keys and their types remain stable. Cosmetic labels cannot change stored
   values, permission keys, module dependencies or mandatory integrity rules.
2. Required custom fields remain supported. Preserve `requiredSince`, record
   creation dates and shared SALES conversion cohorts, so old records do not
   suddenly fail unrelated edits. Hidden/uneditable fields must not trap users.
3. Tenant terminology resolves in one order: explicit tenant override, installed
   module default, core default. No industry detection from tenant names/domains.
   Validate length, reject ambiguous labels in the same form/import mapping, and
   audit changes. Tenant administrators configure overrides; existing manager
   permissions are not silently expanded.
4. Default labels reproduce today's screens for existing tenants. Do not rewrite
   saved category names, custom option names, statuses or activity types.
5. Import identity uses stable field keys/codes; display labels are suggestions,
   not storage keys. Downloaded templates and mapping must remain round-trippable
   after labels change. Pending imports must be migrated explicitly if their
   mapping shape changes; do not silently discard them or add a permanent parser
   for each historical schema.
6. Saved quotation revisions keep their captured content, labels and calculations.
   Current labels apply to newly created revisions. Never regenerate historical
   snapshots from today's projects/custom fields. A retained immutable snapshot
   is business history, not a second legacy runtime.

## Data-preservation and migration specification

Current schema separates `RealEstateEnquiryContext` and
`RealEstateOpportunityContext` from core sales records. Projects, categories and
typed field values have their own tables. No evidence currently justifies moving
these into a generic JSON/EAV record store or rebuilding the database.

| Data group | Required invariant / migration approach |
| --- | --- |
| Organizations, tenants, users, authentication | Preserve IDs, tenant hosts, organization links, password hashes and relationships. No reseeding/bootstrap reset. Verify actual tenant identity before any R5 command. |
| Module flags and access | Preserve `TenantModule` allowance/activation, role permissions, `crmRecordScope`, team-manager designations and project membership. Compare effective access for admin, manager, custom-role and staff users, not just row counts. Account-role defaults remain an intentional policy unless explicitly replaced with equivalent values. |
| Contacts, accounts and sales | Preserve contact/account links, owners, assignees, team IDs, pipeline/stage IDs, conversion links, amounts, currencies, dates, status and version counters. Reconcile by ID and relationship, not title. |
| Real Estate | Preserve parent-child hierarchy, project/category links, memberships, enquiry/opportunity context and archived choices. Subprojects must still belong to the selected project in the same tenant. |
| Activities/history | Preserve plans, follow-up chains and limits, reminders, completion/outcome history, authors and timestamps. Preserve date-only versus instant semantics. |
| Custom fields | Keep definition/option/value IDs, types, codes, team scope, saved labels, indexes and required cohorts. Do not convert relational fields to custom fields. |
| Quotations/payment plans | Compare template content and every revision JSON hash, revision number, currency, totals, dates and opportunity link. Preserve embedded assets and externally stored documents if discovered. No recalculation of saved money. |
| Imports | Preserve batch owner/tenant, mappings/defaults, row numbers, validation errors, statuses and created-record references. Complete resumable jobs with no duplicate creation after migration. |
| Operational data | Preserve appointments, service/package lines, product lines, purchases, stock ledgers/on-hand quantities, suppliers/taxes/coupons, leave approvals and shift assignments. Keep existing financial precision and inventory units. |
| Audit and settings | Preserve original event payloads and actor IDs, locale/timezone/currency, work schedules and business settings. Add a migration execution record; do not rewrite history to match new labels. |

Expected schema work is an additive tenant terminology/configuration structure in
R3, tenant-scoped and indexed by stable key, with RLS and audit coverage. The exact
SQL is a deliverable of that implementation, not an executable part of this audit.
If code extraction needs no schema change, do not create a cosmetic migration.

Keep current physical table names where they still describe the data. A `Crm`
prefix is not a reason to migrate rows or maintain an alias layer. If an obsolete
column really must go (for example the documented leave-rule mirror), first
inventory all consumers and actual values, specify deterministic conversion and
discrepancy handling, rehearse it, then remove consumers and column in the same
release. Never edit checksums of migrations already applied.

Each changed shape must have: old/new mapping, tenant-scoped preconditions,
explicit handling of ambiguous/null data, before/after reconciliation, indexes
and RLS, and a cutover recovery path. Unknown data is a stop condition, not an
invitation to invent defaults. One forward upgrade path; no permanent dual writes
or old/new runtime flags. A temporary deployment maintenance gate is operational,
not legacy support.

## Delivery sequence and gates

### R1 - audit and design (complete)

Deliver this source map, target boundaries, migration invariants and baseline
checks. Live-data inventory, backup/restore rehearsal and performance measurement
are explicitly pending, not implied by this completion.

### R2 - shared module cleanup (complete locally)

Work in small local batches: (a) extension/query/report/export/import boundaries,
(b) dashboard and platform dependencies, (c) Sales Documents contracts and shared
UI aliases, (d) operational service extraction and neutral wording. Capture
behaviour before moving it. Update all consumers together; no compatibility shims.
Keep the current routes and permission semantics. Finish each batch's tests before
the next. Do not enable new features or push/deploy intermediate work.

### R3 - common configuration

Resource-owned custom-field registration and contextual validation, then the
shared terminology catalog/store/resolver and current consumer integration.
Update form labels, validation messages, navigation, column pickers, reports,
CSV template/mapping/export and newly generated documents together. Existing
records and snapshots follow the preservation rules above. Provide an explicit
coverage list of configurable keys; do not imply every technical string is editable.

### R4 - complete Real Estate isolation and migration package

Implement the Real Estate providers for the final contracts; move its preset,
report, dashboard and import-specific behaviour under its ownership. Remove
superseded code. Module-off UI and APIs must hide/reject industry operations and
skip property queries while retaining stored data. Package any pending schema/data
migrations and reconciliation scripts for one release, not per-client forks.

### R5 - rehearsal and controlled cutover

1. Read-only inventory of the actual target: deployment/project ID, database and
   tenant IDs, migration checksums, table sizes, import/reminder work in flight,
   asset storage and active integrations. Do not assume the old `.env` or local
   Vercel link points to the current deployment.
2. Take a protected consistent backup including required asset storage, verify
   restoration into an isolated database, and restrict access/retention. Suppress
   email, background jobs and external side effects in the rehearsal environment.
3. Rehearse the exact release migration with non-bypass runtime access tests;
   compare per-tenant counts, ID sets, FK/orphan checks, financial aggregates and
   snapshot hashes. Run module-on/off and permission scenarios plus real workflows.
4. Agree a maintenance window. Stop writes at the server, including imports, jobs
   and integrations; drain in-flight work. Take a final recovery snapshot. Record
   the matching previous application release and environment configuration.
5. Apply migrations to the verified database and deploy the matching release.
   Force stale browser clients to reload if contracts changed. Verify before
   reopening writes; a code-only Vercel rollback is not enough after schema changes.
6. On failure before reopening, restore the database/assets and previous app as
   one recovery operation. After reopening, do not restore an old backup over new
   client activity: stop writes and choose a reconciled recovery or forward fix.

No production push, migration, data restore or deployment is part of R1-R4.

## Verification and performance checklist

- Extend `tests/crm-extensions.test.cjs` beyond import checks: core must have no
  property-specific contract assumptions; platform/neutral UI must not import
  business implementations. Explicit application composition is permitted.
- Retain `tests/module-navigation.test.cjs`, `access-policy.test.cjs`,
  `module-access.integration.test.cjs`, `access-roles.integration.test.cjs` and
  `crm-record-scopes.integration.test.cjs`; cover every module disabled and every
  denied action server-side, not just hidden buttons.
- Run CRM, Real Estate, custom-field, team, sales/report, import and quotation
  integration suites against isolated data. Extend them for label collisions,
  required cohorts, changed import metadata and immutable historical revisions.
- Use existing inventory/services/appointments/workforce integration suites for
  each extraction; verify stock and financial effects once per transaction.
- Run `tests/local-access/` browser flows, inspect screenshots and verify desktop
  and mobile controls, module-off states and accessible names after label changes.
- Measure baseline and final query counts/plans on the protected copy: page-sized
  batched decoration, bounded report previews, SQL aggregates and indexed tenant
  filters. No per-row config lookup, label/custom-field join added to every query,
  unbounded history scan or cross-tenant cache. Fetch terminology once per request
  or versioned tenant context. Record timings/row volumes; define regression
  limits from measurements rather than claiming unmeasured improvement.
- Gate R5 on typecheck/build, targeted and full release checks, data reconciliation,
  recovery rehearsal and no unresolved access/data-loss failures. A skipped
  migration fixture does not count as a passed upgrade test.

## R1 evidence recorded

- Working tree clean at audit start; baseline commit `5f13238`.
- `npm.cmd run test:crm`: **33 passed, 0 failed, 0 skipped** on 2026-10-16.
- These are local source/unit checks; no database integration, production build,
  live-data reconciliation or browser acceptance was performed for this docs-only
  phase. Historical test results remain historical.
- R1 changes documentation only. Next action: R2(a), neutral CRM extension and
  query/report/export/import boundaries, keeping Ewissen's current data model.
