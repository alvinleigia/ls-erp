# Modular CRM navigation and Sales Documents

Implemented locally on 2026-09-29, following deployed baseline `31c1916`.
Release authorized on 2026-09-29. The module migration is applied to the hosted
database; Prisma confirmed all 87 migrations are up to date. Deploy the application
from main. Full hosted workflow verification remains pending.

## Navigation and configuration

- The application sidebar is the only module navigation, including its mobile drawer.
- CRM: enquiries, opportunities, sales reports and sales configuration.
- Contacts: people and business accounts.
- Activities: overview, My Work, calendar and activity configuration.
- Sales Documents: paginated quotations and reusable templates, shown only when enabled.
- Real Estate: projects and property configuration, shown only when enabled.
- Configuration cards and active sidebar states follow those owners. Existing
  record URLs remain valid. Contacts and activities remain shared CRM capabilities.
- Existing salon menus are unchanged; they are not falsely represented as
  independently enforceable modules.

Business administrators use **Settings > Modules**. CRM is required for Real Estate
and Sales Documents. Payment Plans is an optional capability of Sales Documents.
Generic quotations can be used without Real Estate and without Payment Plans.
Disabling a parent requires disabling its dependents first; changes remain audited.

## Data and permission behaviour

- The migration `20260929200000_optional_sales_documents` preserves access by
  enabling Sales Documents and Payment Plans for existing enabled CRM businesses.
  Explicit pre-existing disabled flags are preserved. New businesses start with
  optional modules disabled. CRM records and document snapshots are unchanged.
- Disabling Sales Documents blocks its pages, APIs, templates and PDF downloads.
  Re-enabling restores access to saved records under the existing permissions.
- Disabling only Payment Plans leaves saved schedules readable and downloadable.
  New scheduled documents/templates and edits to existing scheduled documents are
  blocked, including attempts to remove the saved schedule. Re-enable to edit.
- New quotation-only content has no instalment schedule. Its totals and PDF omit
  the schedule section. Enabled businesses can add optional instalments, which
  still must total exactly 100%.
- Tenant, role and opportunity ownership checks remain in place. Module enablement
  never broadens record visibility. Concurrent toggles share a tenant CRM lock
  within serializable transactions; audit failure rolls back the change.

## Code boundaries and queries

- `platform/modules.ts` owns module definitions and dependency rules; Settings
  and server mutations consume the same rules.
- `application/navigation.ts` is the single sidebar definition for these groups.
- `platform/module-provider.tsx` shares one module fetch across the sidebar and
  extension panels and refreshes after a module change. Server requests always
  check fresh database flags rather than trusting client state.
- `modules/sales-documents` owns quotation calculation, validation, service, PDF
  and UI. Application composition installs its service and opportunity panel.
  Core CRM does not import Sales Documents or Real Estate implementations.
- Public routes and existing `CrmQuotation*` table names stay compatible.
- The new all-opportunities list is tenant/ownership scoped, searches document
  titles and uses bounded server-side pagination. A tenant/date/id index supports
  the list; existing opportunity-specific indexing remains.
- A local 1,006-document list returned five rows using nine SQL statements with
  no revision JSON query. This is a query-count check, not hosted latency evidence.

## Verification and release

Local checks cover core isolation, navigation ownership, calculations, real
PostgreSQL RLS/permissions, migration preservation, module dependencies, concurrent
toggles and audit rollback. Browser checks cover module navigation, template use,
immutable revisions, quotation-only PDFs, disable/re-enable behaviour and mobile
controls. Screenshots and a quotation-only PDF were visually inspected.

Passed: production build including TypeScript, targeted lint, 27 CRM/navigation
checks, six calculation checks, ten PostgreSQL integration scenarios and three
desktop/mobile browser scenarios. Existing saved-schedule PDF download remained
available after disabling Payment Plans and returned 403 after disabling Sales
Documents. All business-changing checks used an isolated local database.

Release the application with the new migration applied first. No seed/reset or
fixture script should target the hosted database. Then use the existing CRM Test
leads for the deferred full workflow review. The migration is additive and retains
all data; do not delete document revisions when rolling back application code.
