# CRM navigation and optional capabilities

Implemented locally on 2026-09-29. Sidebar reorganization, optional Sales Documents,
Payment Plans capability, service extraction and local checks are complete.
The new migration is applied to the hosted database; application release is authorized via main. Full hosted workflow
testing remains deferred. See [delivery notes](CRM_MODULE_NAVIGATION_DELIVERY.md).

## Baseline before this refactor

- `platform/modules.ts` registers CRM and Real Estate. Business administrators
  toggle them in Settings > Modules. Changes are audited and tenant scoped.
- `platform/module-service.ts` enforces the Real Estate dependency on CRM, but
  the validation and dependency rules are hard-coded for these two modules.
- Real Estate already owns its services and contributes fields, context and
  views through the application CRM extension boundary.
- Quotation services, templates, PDF generation and instalment schedules are
  inside CRM and share its access check. There is no independent feature switch.
- The sidebar duplicates a second navigation inside the CRM layout. The latter
  has now been removed locally, including its unused Real Estate flag query.
  The application sidebar and its mobile trigger remain available.
- Existing salon modules are not yet independently enforceable business modules;
  do not present cosmetic switches for them as if their APIs were disabled.

## Proposed sidebar

| Section | Contents | Availability |
| --- | --- | --- |
| CRM | Enquiries, opportunities, sales reports, sales configuration | CRM enabled |
| Contacts | People and business accounts | CRM enabled initially; shared ownership for future consumers |
| Activities | Activity overview, My Work, calendar, activity plans/rules/types | CRM enabled initially |
| Sales Documents | Quotations, quotation templates | Optional Sales Documents module |
| Real Estate | Projects, subprojects, property configuration | Optional Real Estate module |
| Settings | Business settings and Modules | Existing role restrictions |

Sidebar groups are navigation, not automatically independent modules. Contacts
and activities remain shared CRM capabilities initially; avoid duplicating their
tables or inventing extra dependency switches just to create menu headings.
Keep configuration with its owning section, with one Settings > Modules screen
for enabling capabilities. Existing record links remain valid. Use one navigation
definition for enabled sections, route matching and configuration destinations.

## Optional capabilities

- CRM owns lead qualification, opportunities, customer relationships and follow-ups.
- Sales Documents owns quotation templates, calculation, immutable revisions and
  PDF rendering. Initially it requires CRM because documents reference opportunities.
  It is generic and must not require Real Estate.
- Payment Plans is an optional capability within Sales Documents. Businesses can
  use quotations without instalment schedules. It covers proposed schedules only;
  collections, receipts, accounting and booking confirmation remain out of scope.
- Real Estate owns projects and property-specific configuration. It requires CRM,
  and can enrich a quotation when both modules are enabled. Neither optional
  module should require the other.
- Industry presets can propose compatible modules and defaults for administrator
  review; they must not create a separate CRM implementation per industry.

## Enforcement and maintenance

Extend the existing registry with dependencies, capabilities, navigation and
configuration contributions. Use it to drive Settings > Modules and dependency
validation rather than adding more hard-coded cases. Keep application composition
responsible for installing module adapters; core CRM must not import industry code.

Check enabled capabilities and current permissions on server reads, saves,
template operations and PDF downloads as well as in the UI. Module availability
does not grant additional record access. Resolve flags together per request or
transaction; avoid a lookup for each row and avoid stale process-wide tenant flags.
Retain indexed, server-paginated document lists and existing tenant isolation.

Disabling a module preserves all data and makes its routes unavailable until
re-enabled. Disabling just Payment Plans prevents creating/changing schedules;
existing saved versions remain readable/exportable unchanged while Sales Documents
is enabled. Prevent edits that silently drop an existing schedule. Dependency
changes must remain audited and safe against concurrent toggles.

Preserve current enabled customers' access through an explicit migration/backfill
when introducing new flags. New businesses start with optional modules disabled.
Do not rename database tables or move public URLs merely to reorganize menus.
If URLs are changed later, preserve redirects and existing links.

## Implementation order

1. Remove duplicate horizontal/mobile CRM navigation (done locally). Reorganize
   the sidebar using shared navigation definitions and correct active states.
2. Extend the module registry, Settings controls and server guards. Add separate
   Sales Documents and Payment Plans flags with dependency checks and preserved
   access for existing CRM businesses.
3. Extract quotation code into Sales Documents behind the application composition
   boundary. Add a scoped, paginated quotation list for its sidebar entry. Move
   Real Estate navigation/configuration contributions to its own section.
4. Check toggle/dependency/permission combinations, preserved saved PDFs, existing
   URLs and desktop/mobile navigation. Then run the deferred end-to-end review
   using existing CRM Test leads. No hosted fixture or reset scripts.

This keeps one application and database. Independently deployable services and
separate business-specific codebases are unnecessary for this scope.
