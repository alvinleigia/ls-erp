# CRM architecture alignment with Odoo

Decision date: 2026-09-29. Phases 1-4 are implemented locally; see
[Phase 1 delivery](CRM_ODOO_PHASE_1.md), [Phase 2 delivery](CRM_ODOO_PHASE_2.md),
[Phase 3 delivery](CRM_ODOO_PHASE_3.md) and [Phase 4 delivery](CRM_ODOO_PHASE_4.md).
These changes are not deployed. Phases 2-4 add database migrations verified
against disposable local databases.

This is the active forward plan following the user's decision to refactor early
and use Odoo as the benchmark. Previous CRM phase documents remain historical
delivery and verification records. Their older pending-deployment notes are not
a statement of the current release. The latest recorded release baseline is
commit `3e2971c`, including configurable activity types and its migration.

## Scope and benchmark

Deliver reusable CRM and sales with an optional Real Estate extension. Preserve
the existing testing leads, activities, permissions and history. No client pilot,
legacy import, hosted fixture reset or new business-specific CRM engine is part
of this work. Payments, booking/reservation transactions, accounting, document
management and delivery-project management remain deferred.

Odoo is a functional and configurability benchmark, not a requirement to copy
its database, framework or every application. Relevant first-party references:

- [Property fields](https://www.odoo.com/documentation/19.0/applications/essentials/property_fields.html):
  configurable fields; CRM properties are associated with a sales team and task
  properties with a project. Here, "property" means an additional field, not real estate.
- [Sales teams](https://www.odoo.com/documentation/19.0/applications/sales/crm/pipeline/manage_sales_teams.html):
  team membership and assignment configuration.
- [Real Estate Agency](https://www.odoo.com/industries/real-estate-agency):
  property listings, visits and customer/sales workflows in an industry solution.
- [Project milestones](https://www.odoo.com/documentation/19.0/applications/services/project/project_management/project_milestones.html):
  delivery milestones associated with tasks. This is distinct from a property
  development that enquiries and opportunities concern.

## Review baseline before Phase 1

| Area | Present | Work needed |
| --- | --- | --- |
| Shared CRM | Contacts, accounts, enquiries, conversion, opportunities, pipelines, activities, rules, plans, history and reports | Preserve behavior; reduce industry coupling |
| Configuration | Pipelines/stages, sources, lost reasons, activity types | One configuration entry point; extend missing catalogs |
| Real Estate | Optional module, projects/subprojects, developer, location, prices, staff access, buyer requirements and sales links | Configurable project choices and additional fields |
| Extension boundary | Separate module folders and module flags | CRM validation, services, reports and UI still directly depend on Real Estate |
| Project choices | Fixed lifecycle, category and buying-timeframe choices | Tenant-managed catalogs with stable identities and migration |
| Additional fields | Typed fixed domain fields | Shared definition, validation, rendering and query support |
| Sales teams | Individual assignment and manager-wide reporting | Actual team membership/configuration is not implemented |
| Property stock and website | No unit inventory or public listing system | Later scope; do not imply current projects are reservable stock |

Evidence: `modules/real-estate/validation.ts`, `sales-validation.ts`,
`sales-context.ts`, `service.ts`, `components/project-sales.tsx`;
`modules/crm/service.ts`, `sales-service.ts`, `sales-report-service.ts`,
`validation.ts`, `sales-validation.ts`; `platform/modules.ts`.

## Architecture decisions

1. **One shared CRM.** Industries reuse contacts, enquiries, opportunities,
   activities, permissions and reporting. An industry can have its own menu and
   screens without duplicating these services.
2. **Real Estate owns property developments.** Keep current project/subproject
   records and typed relationships. Do not turn them into generic delivery
   projects or SaaS tenants. A later Project Management module can own tasks,
   delivery milestones and execution separately.
3. **Explicit extension integration.** Shared CRM defines the integration
   contracts; application composition connects installed extensions. Real Estate
   provides its validators, field sections, conversion behavior and query
   contributions. Avoid circular imports and a barrel file that merely hides the
   same dependency. Do not build a runtime plugin loader or arbitrary scripting.
4. **Shared configuration, typed business data.** Common fields and relationships
   stay in indexed domain tables. Additional fields use an allowlisted typed
   definition/value design with declared query capabilities. Do not move all
   records into an unvalidated JSON document or generic entity table.
5. **Keep reliable semantics.** Configurable labels do not redefine won/lost,
   active/archived or activity behavior. Archive referenced choices; preserve
   identifiers and historical labels. No promise of unlimited configuration.
6. **Preserve enquiry conversion.** Keep existing enquiry/opportunity tables and
   links for now. Centralize shared rules where useful; merging tables requires a
   demonstrated benefit and separate migration design, not visual Odoo parity.
7. **Site visits are activities by default.** Use a configurable Site Visit type
   with Meeting behavior. A business can also configure visit pipeline stages if
   they represent a useful sales milestone. Do not add a stage for every task or
   rewrite existing pipelines automatically.

## Phase 1 — isolate industry integration

Implemented locally. See [delivery and verification](CRM_ODOO_PHASE_1.md).

Deliver the smallest complete boundary around existing Real Estate integration
before adding another industry-specific field.

- Inventory integrations across validation, saves, conversion, reads, filters,
  reporting and UI. Define narrowly typed contracts for actual existing needs.
- Move extension selection to application composition. Shared CRM must not
  directly import concrete Real Estate implementations when this phase finishes.
- Retain transaction-bound extension writes and audits, tenant/record permissions,
  optimistic versions and current response compatibility. Conversion must retain
  its context even when the industry module is disabled.
- Add a CRM Configuration entry point grouping existing settings. Preserve old
  links and standard forms, controls and pagination.

Acceptance: existing core and Real Estate regressions pass; module-off CRM works;
unauthorized/cross-tenant operations fail; context survives conversion; no added
per-row queries or unbounded registry lookup. Verify imports as well as behavior.

## Phase 2 — configurable project choices

Implemented locally. See [delivery and verification](CRM_ODOO_PHASE_2.md).
Configuration paths (available after deployment):
`CRM > Configuration > Real Estate > Project statuses / Property categories /
Buying timeframes`.

- Replace fixed choices with tenant catalogs, using the established sources,
  lost-reasons and activity-types patterns instead of separate admin frameworks.
- Support labels, order, defaults and archive. Keep any required operational
  semantics explicit and stable rather than inferring them from user labels.
- Backfill existing values into equivalent choices per tenant. Preserve projects,
  buyer requirements, filters, report counts and historical values.
- Define shared category ownership once for project supply and buyer interest.
  Keep project lifecycle separate from sales opportunity stages.

Acceptance: existing values reconcile before/after migration; archived selections
remain readable and cannot be newly assigned; catalogs enforce tenant FKs and
versions; lists/selectors paginate on the server. No hosted data reset.

## Phase 3 — reusable additional fields

Implemented locally. See [delivery and verification](CRM_ODOO_PHASE_3.md).
Path: `CRM > Configuration > Custom fields`, selecting the record type.

- Start with projects, enquiries and opportunities; reuse the same renderer and
  validation infrastructure. Industry modules register their supported record
  types instead of forking the field engine.
- Initial types: text, number, date, checkbox and single-select. Define limits,
  defaults, help text, order, field permissions and archive behavior. Arbitrary
  scripts, SQL, file uploads and computed-field expressions are outside this phase.
- Tenant/entity scope first. Do not introduce a fake team scope before actual
  sales teams exist. Design scope identity so a later team scope can be added.
- Decide storage and indexes with a small query benchmark before migration.
  Definitions need stable IDs; values need valid tenant-owned record links,
  typed validation and bounded size. Searchable/filterable capabilities are
  explicit; no full-table JSON scan for standard CRM screens.
- Required-field changes must not strand existing records: either backfill first
  or enforce prospectively with clear edit behavior. Preserve history on field
  rename/archive; reject incompatible type changes with existing values.
- Map compatible enquiry fields on conversion explicitly. Preserve provenance;
  never silently discard or merge incompatible values.

Acceptance: definitions, reads, writes, exports and filters obey tenant and record
scope; old records remain usable; indexed filter plans and bounded query counts
are measured on disposable local data; module-off behavior remains valid.

## Phase 4 — sales workflow configuration

Use the refactored foundations for the next CRM capabilities rather than adding
special cases per industry.

- Implement sales teams and membership with explicit visibility and assignment
  rules. Current manager reporting is not a substitute for this capability.
- Define whether a team uses an enquiry qualification step or starts with direct
  opportunities. Preserve today's workflow as the migration default.
- Add explicit, previewable industry presets for choices, fields and activity
  types. Applying/updating a preset must not overwrite business customization.
- Add team-scoped additional fields only after membership and access tests pass.

Acceptance: configuration changes do not broaden existing access accidentally;
staff assignment, reports and conversion reconcile; a non-property configuration
works without Real Estate enabled. Avoid inventing another full industry module
just to demonstrate extensibility.

## Verification and rollout for every phase

- Capture a read-only baseline of existing CRM Test records, counts, links and
  permissions. Use those records for the agreed internal regression. Record local
  verification separately from hosted deployment verification.
- Use disposable local data for destructive, migration and scale tests. Never
  run seed/reset scripts against the hosted database.
- Verify enquiry conversion, project context, activity completion, follow-up
  limits, lost reasons, custom activity types, timelines and standard controls.
- Check query plans and query counts for scoped lists, selectors and reports;
  retain server pagination, batch decoration and bounded exports. Report actual
  measurements with dataset size, not unsupported performance guarantees.
- Review a backfill/reconciliation and recovery plan before each migration.
  Prefer additive compatible migrations; delay removal of legacy columns until
  the new path is deployed and reconciled. App rollback alone is not a database
  rollback plan.
- Complete an increment, test it and record the release before the next phase.
  Mark capabilities implemented only after verification; do not claim full Odoo
  parity from this plan.

## Immediate next implementation

Phases 1-4 are implemented and the three hosted migrations applied on 2026-09-29.
Release the checkpoint; by user instruction, defer full hosted workflow verification
until after payment-plan implementation, retaining existing CRM Test records. Next agreed
feature: reusable quotations/payment-plan documents linked to opportunities,
with configurable charges and instalments; collections/accounting remain later.

## Subsequent quotation / payment-plan increment

Implemented locally after checkpoint `df1b560` was released. See
[quotation delivery](CRM_QUOTATIONS_PAYMENT_PLANS.md) and
[checkpoint status](CRM_CHECKPOINT_2026_09_29.md). The quotation migration is applied and the application release is authorized;
full hosted workflow verification is deferred
by user instruction until after this increment.
