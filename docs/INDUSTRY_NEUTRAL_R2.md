# R2 shared module cleanup

Date: 2026-10-16. Baseline: `5f13238`, with the R1 audit already present locally.
Scope: R2(a), CRM query/report/export/import boundaries, and R2(b), dashboard and
platform dependencies. R2(a) and R2(b) are implemented and verified locally.
R2(c) and R2(d) are also complete locally, including operational batches 1-24
and the completion review below. No production release. R3-R5 are pending.

## R2(a): CRM extension boundaries

- `CrmExtensions.splitQuery` separates and validates installed extension filters
  before strict core list/report parsing. Project/subproject fields are owned by
  `modules/real-estate/crm-extension.ts`, not CRM list/report schemas. Enquiry,
  opportunity and work scopes still apply before any extension filter.
- Reports use code-owned SQL values, display columns and grouping descriptors.
  Request grouping keys are matched to this allowlist before SQL execution.
  Module-off reports have no property joins or projected property keys. Core
  source, salesperson and lost-reason groupings remain available.
- Report rows expose `extensionValues`; report metadata exposes
  `extensionColumns` and `dimensions`. Shared report UI and CSV rendering consume
  those descriptors. Real Estate supplies Project/Subproject columns and project
  grouping; the shared UI no longer branches on `realEstateEnabled`.
- List exports are service methods (`exportEnquiries`, `exportOpportunities`)
  using the existing permission-checked, scoped, bounded selection. The route is
  only an HTTP adapter. Real Estate export values are produced in the existing
  batched decoration pass, with no additional per-record lookups. Custom-field
  export, CSV escaping, sorting and export limits remain shared.
- Import field metadata declares `allowDefault` and `dependsOn`. Both client and
  row validation use the shared choice-filter helper; changing a parent default
  clears dependent defaults. Real Estate defines the hierarchy. Import providers
  list parent fields before their children so row validation resolves parent IDs
  first. Stored mapping/default keys and row state formats are unchanged.
- A shared view hook obtains filter query parameters from the installed view
  provider; the sales report does not construct property query keys itself.

## Data and deployment impact

No Prisma/schema migration, data rewrite, reset, seed or hosted operation is
required by this batch. Existing tenant IDs, permission/module settings, saved
imports, project links and quotation snapshots are unchanged. Local integration
and browser fixtures use only the dedicated disposable database.

The internal sales-report response contract changes together with all in-repo
consumers; there is no old-response adapter. R5 must deploy frontend and server
together and refresh stale clients. Recheck any external integrations during the
R5 inventory before cutover. Existing page URLs and CSV column names remain valid.
With Real Estate enabled the report table shows Project and Subproject as separate
columns supplied by the extension.

This is not a performance benchmark: aggregation stays in SQL, lists remain
bounded, tenant filters remain parameterized and decoration remains batched.
Production-scale query-plan/timing comparison is still part of R5 rehearsal.

## Verification

| Check | Result |
| --- | --- |
| CRM unit suite | 36 passed |
| Enquiry import integration | 13 passed |
| Sales, Real Estate and CRM integration | 104 passed, 4 skipped |
| Local import and sales browser workflows | 7 passed |
| Production build, TypeScript and targeted ESLint | Passed |

The four skipped integration cases require unavailable historical migration
fixtures; they are not counted as passes. All database checks used the disposable
local database, not Ewissen's database. Expected rejection cases (closed activity
and disabled Payment Plans) passed in the browser workflow.

Desktop/mobile report and import-mapping screenshots were inspected. The report
shows extension columns when enabled and removes them when disabled; mobile
controls stack and wide report tables remain within their scroll container.
Artifacts are local under `test-results/local-access` and are not committed.

New regression coverage includes non-property import dependencies, core/extension
filter isolation, a non-property report/export provider, invalid grouping keys,
scoped CSV downloads and module-off report metadata. Browser coverage exercises
project grouping/filtering, mobile layout and module-off rendering, alongside the
existing enquiry correction/reupload and sales workflows.

## R2(b): dashboard and platform dependencies

- `application/dashboard/` composes CRM, Real Estate and Sales Documents queries
  and widgets. Each module owns its result types and section implementation.
  `components/dashboard/widgets.tsx` owns reusable charts, metrics and tables;
  `types/dashboard.ts` holds only shared count/value/period primitives.
- CRM supplies authorized sales scopes to the application composer for project
  counts and quotations. The module functions retain activation/permission checks,
  tenant scopes, database aggregation, preview limits and exact currency values.
  Disabled or denied sections remain null and issue no section queries. The
  dashboard response and KPI definitions are unchanged.
- `application/access-routes.ts` owns route/resource metadata, special multi-read
  requirements, configuration-group access and link-protection registration.
  `platform/access/routes.ts` is a pure metadata resolver. The protected layout
  installs `ApplicationAccessProvider`; platform guards, links and module controls
  consume its route contract. Missing provider setup fails explicitly.
- Generic database constraint/retry classification lives in
  `platform/database-errors.ts`, used by CRM and access-role services. The old
  CRM helper and platform dashboard implementation are removed, with all imports
  updated; there are no forwarding compatibility files.
- Regression checks prohibit domain/application imports from the platform and
  shared dashboard components, exercise independent route metadata and verify
  that unavailable dashboard sections never touch the database.

This batch changes neither persistence nor permission semantics. Operational
dashboard queries still live in the existing summary route and are included in
the R2(d) service-extraction scope; this checkpoint does not claim all application
routes are already thin adapters. Production-scale performance checks remain R5.

R2(b) verification on 2026-10-16:

| Check | Result |
| --- | --- |
| CRM/unit architecture and route-policy checks | 40 passed |
| Dashboard and access-role database integration | 13 passed |
| Dashboard activation and access-control browser workflows | 11 passed |
| Production build (including TypeScript), targeted ESLint, whitespace check | Passed |

No tests were skipped in this batch. Browser checks cover live module toggling,
read-only actions, permission revocation, tenant isolation and account recovery.
Dashboard screenshots were inspected for desktop, mobile sales sections and the
Leaves-only mobile state; mobile overflow assertions passed. Local artifacts are
under `test-results/local-access`. The disposable database was stopped afterward.
No hosted access, schema changes, migration, push or deployment occurred.

## R2(c): Sales Documents contracts and shared UI

- `QuotationDependencies` is owned by Sales Documents and contains only checked
  transaction execution, audit, authorized opportunity scope and optional document
  context. Application composition supplies the existing CRM transaction/scope and
  `realEstateQuotationContext`. Real Estate document context no longer belongs to
  the broad CRM extension interface. The CRM activation dependency is unchanged.
- Document/PDF code uses shared business errors and a document-owned bounded list
  schema. Opportunity lookups select only the fields needed for defaults/snapshots.
  Document context is loaded only after opportunity access succeeds, within the
  same transaction. No quotation snapshots, revisions, prices or audit events change.
- Removed nine CRM UI wrapper files. All consumers now directly import neutral
  ERP controls, sections, pagination, timelines, record selectors and panels.
  Permission-aware page actions, record tabs and record view/edit state moved to
  `platform/access/{record-page,record-tabs,record-view}.tsx`, with explicit Access
  component names. Save/create/edit permissions, tab filtering, discard remounts,
  dirty confirmation and lazy tab mounting remain in those shared implementations.
- Sales Documents no longer imports CRM implementation code or controls. It still
  uses the existing CRM opportunity relationship and database tables; this is not
  a standalone order module or a schema/table rename. No compatibility forwarding
  files or parallel UI implementations remain for the removed aliases.
- Updated `CONVENTIONS.md` to point future work at the current implementations.
  Architecture tests guard neutral presentation/platform dependency direction and
  prevent Sales Documents from importing CRM/industry implementations directly.

R2(c) verification on 2026-10-16:

| Check | Result |
| --- | --- |
| CRM/unit architecture checks | 41 passed |
| Quotation calculation unit checks | 6 passed |
| Quotation and access-role database integration | 17 passed |
| Full local browser suite | 23 passed |
| Production build (including TypeScript), changed-file ESLint, whitespace check | Passed |

No skipped tests. The quotation list check selected five of 1,007 documents using
eight SQL statements and did not fetch revision payloads. This is a bounded-query
regression check, not a production load benchmark. Non-property document context,
access-before-context, plain documents, immutable revisions, audit rollback,
concurrent edits, module switches and payment totals passed.

Inspected quotation/payment-plan, staff read-only and mobile import screenshots.
The import test now checks all five default selectors and operates the salesperson
selector at mobile width; that focused test was rerun successfully after the full
suite. The full suite logged 23 passes with an empty Playwright failed-test list;
PowerShell reported a nonzero wrapper status when redirecting stderr warnings,
not a Playwright test failure. The focused run exited zero.

No production data or configuration was changed. No migration, push or deployment.
The disposable local database was stopped after verification.

## R2(d), batch 1: reusable booking, stock and availability rules

- Appointments now owns order pricing, line resolution, record serialization,
  stock status transitions and scheduling in `modules/appointments/order-*.ts`.
  Routes import these directly; the five former API helper files and the old
  `lib/appointments/order-pricing.ts` are removed, without forwarding aliases.
- Inventory owns `stock-service.ts`: tenant/module/permission checks, stock
  validation, quantity changes and movement recording. It takes the caller's
  transaction and movement description, with no booking status or order-ID
  dependency. Appointments supplies its existing sale/restoration labels; stock
  changes still commit or roll back together with the booking. Existing stock
  queries, movement types and monetary calculations are preserved.
- Workforce owns staff working-time availability (templates, overrides, flexible
  plans, breaks and approved leave). Tenant ID is now required, including at
  runtime. Every staff availability lookup includes tenant scope directly or
  through its staff-profile relationship. Existing callers already supply it.
  This remains an internal availability service used after endpoint authorization;
  it does not grant access to workforce records or change activation rules.
- Services exposes catalog-use authorization from `policy.ts`, rather than its
  HTTP API wrapper. Booking and user eligibility callers share that policy.
- Platform tenant/organization descriptions use "business tenant" instead of
  "salon tenant". No stored tenant names, historical IDs, database names or URLs
  are renamed.
- Architecture checks disallow operational modules importing API implementations.
  Added coverage for booking status stock deltas, non-booking stock movements,
  transaction rollback, missing tenant scope, working breaks, approved leave,
  override priority and flexible availability.

R2(d) batch 1 verification on 2026-10-16:

| Check | Result |
| --- | --- |
| CRM/unit and architecture checks | 43 passed |
| Inventory, Services, Appointments and Workforce database integration | 40 passed |
| Local operational browser workflow | 5 passed |
| Production build / TypeScript / whitespace check | Passed |
| Changed-file ESLint | No errors; one existing tenant-screen hook dependency warning |

No skipped tests. The browser flow covered service/shift setup, purchase receiving,
booking confirmation and cancellation, stock effects, invoice PDF generation,
leave submission/approval and rescheduling in a browser with a different time
zone. Inspected approved-leave and conflict/reschedule screenshots under
`test-results/local-access`. The existing tenant-screen hook warning is unrelated
to the single wording change and remains unchanged.

No production data/configuration changes, no schema migration, no push or
deployment. The disposable local database was stopped after verification.

## R2(d), batch 2: product catalog, purchases and operational dashboard

- Product list/create/edit/archive rules live in `modules/inventory/product-service.ts`.
  Creation and editing share relationship validation and one typed product projection
  and serializer. Pagination, search, SKU checks, tenant-scoped category/supplier/tax
  validation and existing archive behavior are retained. Routes keep HTTP validation,
  logging and the existing module/permission/audit wrapper.
- `purchase-service.ts` owns purchase listing, totals, creation and receipt transitions.
  One typed projection and serializer serve all purchase responses. PATCH now returns
  current received quantities and notes, rather than a pre-receipt snapshot with notes
  omitted. Stock and line changes remain in the purchase transaction; movement rows
  are inserted together. Creation writes received quantities with its new lines.
- Fixed an existing receipt edge case: reopening a received purchase no longer clears
  cumulative received quantities. Updating a purchase locks its tenant-scoped row
  before reading the transition, so concurrent receipts cannot both receive it.
  Receipt permission is rechecked against that locked state. Line tax rounding,
  unit costs, order-number format and monetary fields are unchanged. No historical
  receipt data is rewritten by this local change. R5 should reconcile receipt
  movements against saved received quantities on the protected copy before release,
  in case the old reopen/reset path was used.
- Appointments, Workforce, Services and Inventory own their operational dashboard
  queries in `modules/*/dashboard.ts`. Each provider checks module allowance,
  activation and read permissions before domain queries. Manager leave counts retain
  direct-report scope. Application composition and date policy live in
  `application/dashboard/{summary,period}.ts`; the endpoint is a thin HTTP adapter.
  The existing response shape, widget calculations and date semantics are retained.
  Current-account authorization from `withCoreApi` is reused instead of looking up
  the same access user again in the dashboard handler.
- Product/purchase lists remain server-paged. Stock preview remains limited to eight
  rows and movements use one bulk insert. Operational dashboard period reads retain
  their existing query strategy; this batch does not claim a production performance
  benchmark or SQL aggregation rewrite of all booking metrics.

R2(d) batch 2 verification on 2026-10-16:

| Check | Result |
| --- | --- |
| CRM/unit and architecture checks | 45 passed |
| Inventory, dashboard, Services, Workforce and Appointments integration | 49 passed |
| Local dashboard and operational browser workflows | 6 passed |
| Production build / TypeScript / whitespace check | Passed |
| Changed-file ESLint | No errors; same existing tenant-screen hook dependency warning |

No skipped tests. The 15 Inventory checks were rerun after batching receipt
movements and adding the tax-rounding assertion. The concurrent receipt test uses
two runtime DB connections, confirms both transactions are waiting on a held row
lock, then releases them and checks one stock movement. Two reopen/receive cycles,
direct received creation, current response quantities/notes and tenant rejection
also passed. Product checks cover duplicate SKU, invalid foreign category/supplier/
tax references, clearing suppliers and server paging.

Dashboard providers were tested with a database proxy that throws on any query
when the module is unavailable or denied. Browser tests covered module changes on
an already-open page and the booking/stock/invoice/leave/reschedule workflow.
Inspected all-modules desktop and Leaves-only mobile screenshots under
`test-results/local-access`. No new UI layout was introduced in this batch.

No schema change, production data/configuration change, push or deployment.
The disposable local database was stopped after verification.

## R2(d), batch 3: inventory categories, suppliers and service catalog

- Inventory category and supplier rules now live in
  `modules/inventory/{category-service,supplier-service}.ts`; service category,
  standard-service and package rules live in
  `modules/services/{category-service,catalog-service}.ts`.
- List/create/edit responses share one typed field selection per resource.
  Service creation and editing share category, package-member and active-tax
  validation. Existing package/tax relationships, amounts and partial-edit
  semantics are retained. The service update transaction still updates the
  record and replaces its relationships atomically.
- All eight routes retain HTTP parsing, response shapes/statuses, request logging
  and their existing module/permission/audit wrappers. Module services accept
  parsed input inside the authorized tenant database context and reject missing
  tenant IDs. They are not standalone authorization entry points. Domain
  rejections now pass through the existing shared BusinessError handler.
- Category name conflict checks, server paging (maximum 100), allowlisted sorting
  and tenant-scoped queries are preserved. Referenced categories/suppliers/
  services are made inactive; unreferenced records retain existing deletion
  behavior. No generic CRUD framework, replacement schema or compatibility
  service layer was added.

R2(d) batch 3 verification on 2026-10-16:

| Check | Result |
| --- | --- |
| CRM/unit and architecture checks | 45 passed |
| Inventory and Services integration under tenant RLS | 28 passed |
| Local operational browser workflow | 5 passed |
| Production build / TypeScript / whitespace check | Passed |
| Changed-file ESLint | No errors; same existing tenant-screen hook dependency warning |

No skipped tests. New regression cases cover category duplicates on create/edit,
blank-field clearing and zero values, bounded filtered lists, foreign/inactive
service references rejected before partial writes, replacing package/tax links,
and preserving referenced categories, suppliers and services. Supplier archive
audit snapshots and purchase references remain intact. Existing module-off,
permission and current-role tests also passed. Browser coverage includes service
setup, purchasing, booking stock consumption/restoration, invoices and leave
conflicts. Inspected the leave-reschedule screenshot under
`test-results/local-access`; this batch introduces no new UI layout.

No schema change, production data/configuration change, push or deployment.
The disposable local database was stopped after verification.

## R2(d), batch 4: leave foundations and shift templates

- Moved the four leave helper implementations out of `app/api/leaves` into
  `modules/workforce/{leave-definitions,leave-groups,leave-requests,leave-notifications}.ts`.
  All callers and the notification test stub use the new paths; the old files
  were removed without forwarding exports. Rule checks, lifecycle guards,
  serialization and timeline behavior stay with Workforce.
- Definitions/groups now own list/create/read/update/delete services. The six
  definition/group/template routes retain HTTP validation, existing response
  shapes and module/permission/audit wrappers. They use the checked actor directly
  instead of repeating the session adapter and role check. Other Workforce routes
  still require extraction; this is not completion of all Leaves/Shifts workflows.
- Shared leave helpers require explicit tenant scope. Staff, schedules, leave
  requests, holidays, relationship replacement and notification recipients/settings
  use tenant predicates. Relationship writes verify the owning definition/group;
  group and exclusion replacements stay inside the caller's transaction. Current
  approval/direct-report scopes and notification recipient policy are unchanged.
- Shift templates use one shared break projection, with create/update/delete rules
  in `modules/workforce/shift-templates.ts`. Referenced template deletion still
  returns 409. Paginated queries now reject invalid/noninteger parameters, incomplete page
  pairs and page sizes above 100. Existing table sort fallbacks remain intact. Schedule
  and roster selectors that omit both paging parameters retain their list behavior.
- Regression tests exposed an existing PATCH-default bug: omitted leave-group
  fields could apply creation defaults and switch selective assignment to all staff;
  omitted definition fields could reset rules/exclusions. Update schemas now remove
  creation defaults while retaining validation and explicit false/zero/empty-list
  changes. Tests cover simple edits, retained settings and relationship rollback.
  No historical rows were repaired. During R5 protected-copy reconciliation, review
  saved configuration/audit snapshots if the old partial-edit path was used; do not
  infer or automatically restore an earlier configuration.

R2(d) batch 4 verification on 2026-10-16:

| Check | Result |
| --- | --- |
| CRM/unit and architecture checks | 45 passed |
| Workforce helper, notification and PATCH validation checks | 4 passed |
| Workforce integration under tenant RLS | 13 passed |
| Local operational browser workflow | 5 passed |
| Production build / TypeScript / whitespace check | Passed |
| Changed-file ESLint | No errors; same existing tenant-screen hook dependency warning |

No skipped tests. The integration suite exercises all discovered Leaves/Shifts
routes for disabled/revoked/missing modules, mutation permissions and role ceilings.
New cases cover reciprocal leave restrictions, retained partial-edit settings,
rollback for foreign staff/definitions, group reassignment and audit history,
break replacement, protected template deletion and paging/sort compatibility.
Notification tests use an in-memory delivery stub; no external email is sent.
The browser workflow covers leave submission/approval, booking conflicts and
rescheduling in a browser with a different timezone, plus service/stock/invoice
integration. Inspected the leave-reschedule screenshot under
`test-results/local-access`. This batch adds no new UI layout.

No schema or production data/configuration changes, push or deployment. The
protected-copy reconciliation remains in R5. The disposable local database was
stopped after verification.

## R2(d), batch 5: leave-request workflow services

Implemented locally on 2026-10-16:

- `modules/workforce/leave-request-service.ts` now owns paginated request lists,
  detail/rule/timeline reads, submission, review, cancellation, revocation and bulk
  review. Six request routes are HTTP adapters; activation, action permissions,
  personal-vs-approval permissions and role ceilings stay in `withWorkforceApi`.
  Manager direct-report rules and own-request access remain in the service.
- Existing validation and successful response shapes remain. Invalid submission
  bodies are rejected before any missing staff profile is created. Query paging
  remains bounded at 100 and bulk review at 100 unique request IDs. No fallback
  route implementation or forwarding layer was added.
- Single status transitions now condition their write on the previously checked
  status, returning 409 if another action changed the row. Bulk review uses the
  IDs returned by the conditional write, so a concurrently canceled/reviewed row
  cannot be counted, notified or audited as changed by this action. Existing bulk
  skips for missing, foreign, completed and out-of-scope requests are retained.
- Status changes and past roster-history refreshes share a transaction; history
  failure rolls back the status change. Domain audit events and notification
  delivery retain their existing post-commit/best-effort behavior. This does not
  introduce transactional email or guarantee delivery after process termination.
- Single/bulk approvals retain appointment conflict checks, all-or-none blocking
  for known conflicts, and detail redaction when Appointments is unavailable or
  unreadable. This batch does not solve simultaneous new-booking/leave-approval
  races; that coordination remains to be reviewed before R2(d) is complete.

Verification: 45 CRM/unit/architecture tests, 4 Workforce unit tests and 19
Workforce integration tests passed without skips. Build/TypeScript passed (133
pages). Changed-file lint has no errors after fixing the new test helper variable;
only the pre-existing tenant-screen hook dependency warning remains. Architecture
checks now cover all six extracted routes. All 5 local operational browser tests
passed; 73 distinct tests total, no skips. The leave-reschedule screenshot was
inspected. No new UI layout was introduced. The disposable database was stopped
after verification.

The six new integration tests use an isolated local database with tenant RLS and
an in-memory notification sink. They cover personal pagination/details, validation,
audit snapshots, history rollback, direct-report bulk skips, two competing reviews,
cancellation between bulk eligibility/read and write, and conflict detail privacy.
Concurrency tests delay real eligibility reads; writes and transactions remain
real database operations with a two-connection pool. Tests run with server TZ=UTC,
matching deployment. Existing roster-history helpers use server-local date
construction/getters; audit their non-UTC server behavior during the upcoming
roster extraction rather than claiming server-timezone independence here.

No schema, stored production data/configuration, push or deployment changes.

## R2(d), batch 6: leave queries and standard schedules/assignments

Implemented locally on 2026-10-16:

- Added `modules/workforce/leave-query-service.ts`, `shift-schedule-service.ts`
  and shared `schedule-validation.ts`. Six more routes are HTTP adapters. Existing
  activation, resource permissions and manager/direct-report limits remain.
  Shared schedule projections replace repeated block/template/assignment queries.
- Leave options still depend on active definitions and active all-staff or
  selective groups. Approved-leave and assignment staff filters now use the
  scoped relation directly, eliminating a preliminary lookup. An unmatched
  assignment filter returns an empty list; it no longer drops the filter and
  exposes all tenant assignments. Unfiltered assignment rows now include staff IDs.
- Schedule creation/editing share template/staff validation and overlap checks.
  Mixed valid/unknown/foreign staff selections reject the entire save instead of
  silently saving the valid subset. Flexible-mode staff remain ineligible.
  Calendar dates are validated rather than accepting impossible dates via regex.
  Schedule table pagination requires paired positive integers, capped at 100;
  selectors that omit both paging parameters retain their existing full list.
  Existing unsupported table-sort fallbacks are preserved.
- Standard schedule writes and assignment-ending actions share a tenant-specific
  PostgreSQL transaction advisory lock. It serializes overlap/default decisions
  without locking another tenant's schedule operations. History capture, clearing
  displaced defaults, block/assignment replacement and the save/delete commit or
  roll back together. Ending an assignment cannot extend it into another assignment.
- Default replacement requires edit permission for any default found while holding
  the lock. Its audit records the actual displaced IDs after commit; this specific
  audit moved from the wrapper to the service. The wrapper still logs the main
  schedule/assignment action. Post-commit audit remains best effort, as before.
- Prepared `20261016170000_tenant_default_shift_schedule`: atomically replace the
  old global partial unique index with a tenant-specific default-schedule index.
  The old index prevented a second business from creating its own default.
  No rows, IDs, relationships, module flags or defaults are rewritten. The exact
  migration was applied only to the disposable local database using explicit
  localhost URLs. It remains pending for the protected R5 production release.
  The migration fixture verifies unchanged rows, separate defaults for two tenants
  and rejection of a second default within one tenant.

Verification: 45 CRM/unit/architecture checks, 4 Workforce unit checks and
26 Workforce integration/migration checks passed without skips. New integration
coverage includes selective leave options, scoped approved/assignment queries,
invalid dates/paging, mixed foreign selections, independent defaults, assignment
end permissions/collisions, rollback after a deliberately failed block insert,
concurrent overlap protection and accurate displaced-default audits. Migration
and runtime tests use isolated local data; no client records or external mail.
All 5 local operational browser tests passed: **80 distinct checks total**, no
skips. Production build/TypeScript (133 pages), whitespace and local migration
status passed. Changed-file lint has no errors and the same pre-existing tenant
screen hook dependency warning. Inspected the leave-reschedule screenshot. No UI
layout changes were introduced. The disposable database was stopped after checks.

Existing roster-history helpers still need the previously documented server-timezone
review. This batch preserves standard-schedule delete/history behavior, not a new
archive model. Coordination with flexible scheduling, booking resolution and user
scheduling-mode changes remains in the next operational batches; do not claim the
new lock covers those other writers. No production changes, push or deployment.

## R2(d), batch 7: daily roster overrides, slots and history

Implemented locally on 2026-10-16:

- Added `modules/workforce/roster-service.ts`; override, daily flexible-slot and
  roster-history routes are HTTP adapters. Their module, resource, role and
  template-read gates and audit snapshots remain in the shared API wrapper.
  Weekly plans and recurring patterns are still pending extraction.
- Override and daily-slot lists use direct tenant/staff relation predicates.
  Unknown/foreign staff selections remain empty rather than dropping the filter;
  unfiltered lists now return real staff user IDs. History retains its explicit
  staff-selection contract. Missing/foreign templates reject the entire save.
  Real calendar dates, ordered ranges and valid 24-hour slot times are enforced.
- Both daily save paths share bounded appointment candidate queries and business
  date comparisons, including positive/negative UTC offsets, overnight overlap,
  local-midnight endpoints, shift breaks and conservative DST rollback handling.
  Conflict counts remain available while customer/service details are redacted
  without active Appointments and appointment-read permission.
- Standard schedules, assignments, daily overrides and slots now reuse
  `schedule-transaction.ts`. Its tenant-specific lock serializes these writers.
  Daily changes and affected past-history snapshots commit or roll back together.
  Consecutive changed dates are grouped for history queries. Skipped holidays and
  week-offs retain their overrides and snapshots. Existing snapshots remain
  unchanged on history reads; only missing days are inserted, as before.
- Moved `lib/roster-history.ts` into Workforce and removed the old implementation;
  all consumers/tests use the owning module directly. Tenant context is mandatory,
  profile-related queries are explicitly scoped, and only resolved tenant profiles
  can produce rows. Removed the old missing-delegate compatibility fallback.
  Database DATE arithmetic/weekday/rotation handling uses UTC calendar dates;
  business timezone determines the cutoff for past history. Leave transitions and
  standard-schedule capture now supply that timezone too.

Verification: 45 CRM/unit/architecture checks, 8 Workforce unit checks,
29 Workforce integration checks and 2 migration checks passed without skips.
Tests exercise both tenants with a non-bypass runtime role, denied actions,
foreign templates, UTC-boundary/overnight/break conflicts and redaction,
concurrent slot replacement, save/delete rollback on history failure, preserved
holiday/week-off snapshots and audits. Date/history generation is additionally
checked in child processes with UTC, Asia/Kolkata and America/Los_Angeles server
zones. No external mail or client data is involved.
All 5 local operational browser tests passed: **89 distinct checks total**, no
skips. Production build/TypeScript (133 pages) and whitespace checks passed.
Changed-file lint has no errors and the same pre-existing tenant-screen hook
warning. Inspected the leave-reschedule screenshot; no UI layout changes were
introduced. The disposable database was stopped after verification.

Release limits: no new migration in this batch. The batch-6 tenant-default index
migration remains pending for R5. No production changes, push or deployment.
Booking writers, leave transitions, recurring plans and staff-mode edits do not
all share the scheduling lock yet; this does not solve every concurrent booking
race. Deleting daily slots/overrides retains existing fallback behavior and does
not introduce a new conflict-resolution workflow; assess that with remaining
weekly/recurring scheduling and booking coordination. R5 should reconcile old
roster DATE snapshots if they were produced on non-UTC servers; no speculative
bulk date correction is performed here.

## R2(d), batch 8: weekly plans and recurring schedules

Implemented locally on 2026-10-16:

- Seven weekly-plan/recurring-pattern route files now delegate to Workforce
  services. Shared record projections, ordering, serialization and nested
  day/slot/break creation replace duplicated GET/save/clone implementations.
  Removed the now-unused `workforceSession` transitional adapter. All Leaves
  and Shifts routes use the shared API boundary and module-owned rules.
- Weekly save/clear, recurring save/clone/deactivate now participate in the
  existing tenant-specific scheduling transaction lock. Overlap decisions,
  displacement, nested replacement and displacement audit commit together.
  The existing rule remains: replacing an overlapping active pattern requires
  archive permission and deactivates the entire old pattern; it does not trim
  or split its date range. Concurrent writers cannot both leave overlapping
  patterns active through these service entrypoints.
- Fixed same-staff cloning: the source is included in overlap detection and
  permission checks because the clone is a new record. Editing still excludes
  itself. Clone audits now identify and snapshot the newly created destination
  while retaining the source before-snapshot. Activation changes are checked
  against the actual locked state, including omitted `isActive` values that
  default to true. Same-staff cloning also verifies Flexible scheduling mode.
- Scoped all profile/pattern queries and mutation predicates. Weekly mixed-staff
  reads retain their existing scoped-subset behavior; wholly missing profiles
  return 404. Recurring roster filters remain empty for unknown/foreign staff.
  Shared list validation bounds paging to 100, rejects non-integer pages and
  validates real dates/range order. Weekly starts must be Mondays. Save schemas
  validate valid clock times; preview draft cycles reuse save validation.
- Shared impact preview remains advisory and preserves its response fields.
  Fixed the inclusive horizon from 91 to 90 calendar days, used business-local
  date boundaries for appointment overlap counts and matched clone/update
  overlap counting to the write rules. Effective-now list flags also use the
  business date. Planned-time estimate fields keep their existing names for
  the current UI; these are not actual booking-duration or revenue measures.
- Weekly overrides, recurring cycle selection and slot breaks were checked
  through the existing appointment availability consumer. No new compulsory
  fields, module switches, industry dependencies, schema migration or bulk data
  updates were introduced.

Verification: **96 distinct checks passed**, with no skips: 45 CRM/unit/architecture,
8 Workforce unit, 35 Workforce integration, 2 migration and 6 local operational
browser checks. New coverage includes scoped weekly/recurring reads, nested
ordering/break preservation, Monday/date/paging validation, clone destination
audits, actual-state activation permissions, concurrent overlapping saves,
transaction rollback after forced break-insert failures, 90-day/local-date
previews and weekly/recurring booking-availability precedence. Five existing
browser workflows passed; the new plan workflow passed in a focused rerun after
correcting its fixture to use a separate Flexible employee. The standard-mode
assignment safeguard was preserved. Inspected the loaded recurring-plan detail
screenshot, including weekly slots/breaks. Production build/TypeScript (133 pages)
and whitespace passed. Changed-file lint: no errors, one existing tenant-screen
hook warning. Local database stopped after verification. No production queries,
client data changes, push or deployment; no new migration. The batch-6 index
migration remains pending for R5.

Release limits: this extraction does not add a mandatory booking-conflict
resolution workflow to weekly/recurring saves. Existing previews report affected
appointments, and actual booking changes remain separate. Booking, leave and
staff-mode writers do not all share the scheduling lock. The roster-history
builder still needs alignment with weekly/recurring availability precedence
before that coordination is declared complete. These are next-batch work, not
claims that all historical roster calculations or concurrent booking races are
resolved. Main API audit snapshots retain their existing best-effort wrapper
behavior; the displaced-pattern audit remains transactional.

## R2(d), batch 9: appointment queries, availability and standalone creation

Implemented locally on 2026-10-16:

- Appointment list/create and availability routes now parse input and delegate to
  `modules/appointments/appointment-service.ts`. Module activation, role ceilings,
  action/read and Services access remain in the existing API/policy wrappers.
  Historical list/detail access still works when Services is disabled.
- Shared appointment projections/serialization replace repeated definitions in
  list/create/detail. Detail keeps its service-price field; response envelopes,
  status codes and the existing `appointment.created` audit event are retained.
  Request logging and invalid JSON/Zod responses use the shared API boundary.
- Listing retains server-side filtering/count/paging, adds a stable ID tie-breaker,
  and validates real, ordered calendar dates. Date bounds now use the tenant's
  business timezone and next-day exclusive end, including daylight-saving changes,
  instead of assuming that selected dates begin/end at UTC midnight.
- Availability and creation reuse participant lookups and conflict checks. Preview
  remains advisory; excluded appointment IDs must belong to the current tenant.
  Missing/inactive/foreign participants cannot become bookable. All elapsed-time
  duration arithmetic uses instant milliseconds rather than server-local setters.
- Standalone creation now participates in the Workforce schedule transaction lock.
  Participant, shift/leave and staff/customer overlap reads happen under that lock,
  on the same transaction connection as the insert. The Workforce availability
  helper accepts that connection; ordinary read-only consumers still use the shared
  Prisma client. Concurrent standalone creates cannot reserve overlapping active
  slots for the same staff or customer. A create waiting behind a schedule writer
  rechecks its committed working hours. No new schema or data migration.

Verification: **118 distinct local checks passed**, without skips: 45 CRM/unit/
architecture, 8 Workforce unit, 13 Appointments integration, 35 Workforce
integration, 11 Services integration and 6 operational browser workflows.
The new coverage checks positive/negative UTC offsets and DST boundaries, real
calendar dates, stable paging, tenant-scoped exclusions, inactive/foreign
participants, cancellation permissions, creation audits, touching endpoints,
concurrent staff/customer conflicts and waiting behind a schedule transaction.
Two initial fixture errors (SQL timestamp cast and UserStatus value) were corrected;
the complete three-suite integration rerun passed. Inspected the browser's loaded
leave-conflict/reschedule dialog with tenant-local times. Production build and
TypeScript (133 pages) passed. Changed-file lint: no errors, one existing tenant
screen hook warning. Whitespace passed. No schema migration was added or applied;
the batch-6 production index migration remains pending for R5.

Limits: the lock is tenant-scoped and currently covers standard schedules,
assignments, daily slots/overrides, weekly/recurring plans and standalone creates.
It does not yet cover order writers, appointment edits/bulk resolution, staff-mode
changes or every leave transition. Do not claim these other races are fixed.
Weekly/recurring history precedence and mandatory handling of existing appointments
when plans change remain pending. Creation audit delivery retains its existing
best-effort post-commit behavior. No client data, production queries or deployment.

## R2(d), batch 10: appointment edits, cancellation and bulk resolution

Implemented locally on 2026-10-16:

- Appointment detail/edit/cancel and bulk resolution routes now delegate to
  `modules/appointments/appointment-mutations.ts`. Removed their duplicate session,
  logging, validation-response, query and audit implementations. Existing URLs,
  response envelopes, event names and Appointments role/action gates remain.
- These mutations participate in the same scheduling lock as standalone creation
  and Workforce schedule/roster writers. Reads, checks, conditional updates and
  mutation audits use one transaction connection. Services policy accepts that
  connection, avoiding a second pooled connection inside the transaction.
- Status-only reactivation now checks active participants, working hours, leave
  and staff/customer conflicts. Cancellation/reactivation permission is evaluated
  from the current row under the scheduling lock. Cancellation remains possible with Services disabled.
  Single moves preserve the saved elapsed duration unless the service changes;
  changing only customer/staff no longer checks an unrelated catalog duration.
- `appointment-conflicts.ts` owns shared checks. Bulk reassignment checks working
  hours and staff/customer conflicts, including overlap within the proposed batch.
  Bulk rescheduling adds customer checks, preserves exact durations/relative
  offsets and uses tenant-local time conversion (rejecting ambiguous/skipped DST
  times). External bulk conflicts use one bounded query; intra-batch conflicts use
  sorted staff/customer intervals. The existing Workforce availability rules remain.
- Bulk input is capped at 100 IDs; duplicates are collapsed. Missing or foreign
  selected rows reject the whole request rather than silently applying a subset.
  Unchanged rows remain eligible to conflict with changed rows. Repeated cancel,
  same-staff reassignment and zero-offset reschedule return zero changes and do not
  add duplicate audit events. Audits identify only changed IDs and exact counts.
- Single/bulk mutation audits commit with their writes. Audit failure rolls back
  the entire mutation; before/after snapshots come from the transaction. Conditional
  updatedAt predicates detect intervening writes, but are not a client-form version
  contract. No schema migration or historical data rewrite was introduced.

Verification: **125 distinct checks passed**, without skips: 45 CRM/unit/
architecture, 8 Workforce unit, 20 Appointments integration, 35 Workforce
integration, 11 Services integration and 6 local operational browser workflows.
New tests cover saved-duration edits, status-only reactivation, active participants,
external and within-batch staff/customer conflicts, working-hour rejection, exact
bulk offsets, missing/foreign selections, duplicate IDs, idempotent cancellation,
real dates/times/DST, audit-insert rollback for all five mutations, concurrent edits
and competing bulk moves/creates. The new SQL fixture used local Date serialization
initially; fixing its timezone to UTC brought fixture instants in line with the
stored UTC contract, and the complete Appointments/Workforce rerun passed.
The Services suite passed. Inspected the loaded leave-conflict/reschedule dialog;
the browser workflow saved the expected tenant-local appointment time and approved
leave successfully. Production build/TypeScript (133 pages), changed-file lint
(no errors; one existing tenant-screen hook warning) and whitespace passed.
No new migration; the batch-6 production index migration remains pending for R5.
The disposable database was stopped after verification.

Remaining limits: order writers, staff-mode changes and leave transitions do not
all participate in this lock. Linked order line/status synchronization retains its
existing behavior pending the order-workflow batch; this checkpoint does not claim
end-to-end booking/order consistency. Creation audit delivery is still best-effort
post-commit. Weekly/recurring history precedence and existing-appointment handling
on plan changes remain pending. No production queries, push or deployment.

## R2(d), batch 11: booking order list and creation

- Root order GET/POST are HTTP adapters. `modules/appointments/order-service.ts`
  owns scoped, paginated listing and creation, reusing the existing projections,
  serialization, pricing, scheduling and stock helpers. Listing adds an ID
  tie-breaker. Existing permission/module gates and response envelopes remain.
- Confirmed orders search for available sequential slots and suggestions before
  opening the write transaction. Final resolution runs on the scheduling transaction
  client: customer, staff, catalog amounts, coupon usage and working availability
  are reread before any write. A changed duration rejects the preflight plan; changed
  catalog prices are recalculated. Draft/completed/canceled creation resolves once
  inside the transaction, without an unnecessary availability preflight.
- Final conflict checks reuse the bounded shared appointment checks. Creation joins
  standalone create/edit/bulk/roster writers on the tenant scheduling lock. Order,
  lines, linked appointments, totals, stock movements and `appointments.order.create`
  audit commit together. Missing created lines cannot silently omit appointments.
  Expected validation remains 400, availability/stock conflicts 409, and unexpected
  database failures 500 with no internal exception text. Suggestions remain advisory.
- Order resolution accepts the caller's database client, scopes the customer query
  directly, and uses elapsed milliseconds for service durations (also in scheduling).
  The shared inventory helper now uses conditional decrements against the current
  row balance and a stable product lock order. Independent deductions cannot both
  consume the same last unit; failed deductions roll back their transaction.

Verification: **149 distinct local checks passed**: 45 CRM/unit/architecture,
8 Workforce unit, 27 Appointments, 17 Inventory, 11 Services and 35 Workforce
integration checks, plus 6 local operational browser workflows. New cases cover
concurrent orders/standalone bookings, per-
customer coupon limits across simultaneous creates, stable scoped paging, foreign
participants, atomic audit/stock rollback, internal error redaction, independent
stock writers and roster/catalog changes committed after preflight.
Production build/TypeScript passed (133 pages). All changed-file lint passed with
no errors and one existing tenant-screen hook warning; final targeted lint and
whitespace passed. The browser flow verified draft/confirm/cancel stock handling,
invoice access and leave conflict rescheduling; its dialog screenshot was inspected.
The disposable database was stopped after checks.

Remaining limits: order PATCH still owns its existing line replacement, appointment
history/status synchronization and coupon usage behavior; it does not yet share the
scheduling lock. Therefore concurrent create versus order PATCH is not claimed safe
for availability/coupon limits. Standalone create audit is still best-effort.
Coupon/invoice extraction, default-tax selection and order date/time validation
need review in the remaining order workflows. The existing 14-day suggestion search
is unchanged and stays outside the write lock. Leave/staff-mode writers and weekly/
recurring history coordination remain pending. No schema change, production query,
client data change, push or deployment in this batch.

## R2(d), batch 12: order detail/edit and appointment history (2026-10-17)

- Order detail and PATCH are thin HTTP adapters over `order-mutations.ts`. Create
  and edit share explicit line persistence projections. The obsolete route-level
  implementation and duplicate authorization/logging were removed.
- Order edits now join the tenant scheduling transaction. Changed-schedule
  suggestions remain outside the lock; final inputs, coupon usage and conflicts
  are checked inside. Order/appointment snapshots detect intervening writes before
  applying a preflight plan. This is not yet a client-form version contract.
- Service/product lines supplied with IDs are validated against the current order;
  duplicate or foreign IDs are rejected. Existing lines update in place. New lines
  receive server IDs. The editor now sends saved IDs and omits temporary form IDs.
  Lines with appointment history cannot be removed (the global referenced-delete
  rule); unreferenced draft lines can be removed. No old data is rewritten.
- Linked appointments update in place, retaining IDs and links. Status-only edits
  preserve individual canceled/completed/no-show states, except explicit canceled-
  order reactivation can reactivate its canceled slots. Order completion affects
  active appointments only; cancellation preserves completed/no-show history.
  Started/completed/no-show appointment scheduling details cannot be overwritten
  through an order edit. Multiple appointments on one line require review instead
  of automatic destructive replacement.
- Notes and status-only saves retain saved pricing, discounts and line durations.
  Metadata edits can proceed with Services disabled; scheduling, activation and
  financial changes still require the relevant Services/Inventory/Coupon access.
  Repeated status commands are idempotent. Reactivation checks current coupon use,
  active participants, past times and availability. Stock transitions and the
  existing `appointments.order.edit` audit commit with order/appointment changes.
  Audits include before/after linked appointment snapshots. Audit or stock failure
  rolls back the entire edit. Empty-line records cannot broaden appointment queries.
- The booking editor/summary now use tenant wall time for loaded values, previews,
  saves, suggestions and displayed times/dates. Invalid partial date/time inputs
  do not crash rendering. Settings load before editing; saved service durations
  are retained in previews when service and quantity are unchanged. This fixes
  notes-only saves moving a booking when the browser uses another timezone.

Verification: **158 distinct local checks passed**: 45 CRM/unit/architecture,
8 Workforce unit, 35 Appointments, 17 Inventory, 11 Services and 35 Workforce
integration checks, plus 7 local browser workflows. Production build/TypeScript
passed (133 pages). Changed-file lint had no errors; the new hook warning was fixed
and targeted lint passed, leaving the pre-existing tenant-screen hook warning.
Whitespace passed. The browser editor test saved from a Los Angeles browser,
retaining the Asia/Kolkata instant, line/appointment IDs, totals and stock. Its
screenshot was inspected; the summary showed the expected 10:00-11:00 slot.
The disposable database was stopped after checks. New integration coverage includes
preserved IDs/prices/durations, cancellation/restock idempotency, terminal status
history, foreign/duplicate line IDs, referenced-line deletion, draft additions,
active rescheduling, audit/stock rollback, competing creates/edits/coupon use,
stale preflight, past reactivation and empty-line isolation. The old Services test
expected even a metadata-only edit to fail when Services was disabled; it now tests
the intended distinction: metadata succeeds while scheduling/confirmation fail.

Remaining limits: standalone appointment edits do not immediately update their
order's line schedule or aggregate status; automatic reverse synchronization needs
an explicit policy (not every individual cancellation cancels the whole order or
restocks products). Order edits preserve linked appointment state. Historical
orphaned links from older saves are not guessed/repaired. Coupon/invoice extraction,
financial recalculation/default-tax rules and complete order date/time validation
remain next. Status-only confirmation checks saved slots and may return 409 without
an automatic suggestion; changed schedules retain the suggestion response. Leave
transitions/staff-mode writers, weekly/recurring history and plan-change effects
remain tracked. No new migration, production query, client data change, push or
release in this batch.

## R2(d), batch 13: coupon and invoice workflows (2026-10-17)

- Coupon list/create/edit/delete now belong to `modules/appointments/coupon-service.ts`
  with shared list validation and serialization. Routes retain transport parsing and
  activation/action gates. The old duplicated authorization, serializers and
  post-commit coupon auditing were removed from routes/the wrapper. Coupon mutations
  join the tenant scheduling transaction, re-read existing state after the lock and
  commit strict audit records with their writes. Referenced coupons are deactivated;
  unused coupons can be deleted. Used codes cannot be renamed because saved orders
  reference codes, including canceled history.
- Coupon PATCH preserves omitted defaults, restrictions, active state and limits.
  Real calendar dates and merged one-sided date ranges are validated; percentage
  discounts above 100 are rejected. Empty dates and explicit null limits clear those
  settings; the editor sends null when a user clears a limit. Changed eligibility
  selections retain module/read permissions and tenant reference validation.
  Eligibility arrays are capped at 500; list filters reject invalid booleans and
  pagination has a deterministic ID tie-breaker.
- Coupon usage is aggregated in the database, scoped by tenant and requested codes.
  Both global and per-customer limits use non-canceled orders (including drafts),
  exclude the current order during edits, and are rechecked inside the booking
  transaction. Cancellation releases usage. Displayed usage comes from these saved
  order references, not the old unused counter. Missing, inactive or date-ineligible
  submitted codes fail explicitly instead of silently removing the discount.
- Invoice generation and email delivery share `invoice-service.ts`; the existing
  renderer moved from `lib/invoice.ts` to `modules/appointments/invoice-pdf.ts` with
  no compatibility alias. Saved financial amounts are retained when catalog prices
  change or Services/Inventory are disabled. Product lines now appear alongside
  services, and invoice dates/times use tenant timezone. Export/read permissions
  remain required; email also requires edit permission and configured delivery.
  Successful delivery logs the exact rendered order snapshot and recipient. Audit
  remains best effort after external delivery to avoid reporting an already-sent
  email as a failed request. SMTP failure does not record a successful-delivery audit.

Verification: **166 distinct local checks passed**: 45 CRM/unit/architecture,
8 Workforce unit, 43 Appointments, 17 Inventory, 11 Services and 35 Workforce
integration checks, plus 7 local browser workflows. The initial invoice test used
an object instead of a product-line array; correcting that fixture allowed all
43 appointment checks to pass. Tests cover partial preservation, clear operations,
validation, module/tenant permissions, audit rollback, concurrent global usage,
used-code history, coupon lock rechecks and shared invoice delivery. Email transport
was stubbed; no real emails were sent. Production build/TypeScript passed (133 pages),
changed-file lint passed with only the existing tenant-screen hook warning, and
whitespace passed. The generated PDF was rendered and visually inspected: both
items, saved total and 15:30 Asia/Kolkata time for the 10:00 UTC booking were correct.
Checks used only the disposable local database, stopped afterward.

Remaining: default-tax selection, broader financial recalculation and complete
booking date/time validation remain the next bounded batch. Existing coupon
stacking/minimum-subtotal eligibility rules are unchanged. Invoice amounts are saved
snapshots, but item/customer names still come from current relations; this batch does
not add immutable document versions or redesign the receipt for every long-label
case. Existing historical inconsistencies are not repaired automatically. Workforce
coordination, individual-appointment reverse synchronization and R3-R5 remain pending.
No migration, production data change, push or deployment in this batch.

## R2(d), batch 14: booking tax and time validation (2026-10-17)

- Tax selection now distinguishes omission (use catalog defaults) from an explicit
  empty array (no tax). Service tax mode also defaults from the service when omitted.
  Default and explicit IDs are resolved in a bounded second query after catalog
  loading, deduplicated and mapped by ID; inactive/missing/foreign selections fail
  instead of silently disappearing. Explicit zero unit prices remain zero in both
  the editor payload and server calculation. Catalog price changes cannot replace
  an explicitly quoted zero.
- Inclusive lines retain the exact discounted gross when no coupon changes the net
  base. Tax breakdown allocation reconciles to that amount instead of recalculating
  from a rounded net and adding/removing a penny. The corresponding editor tax
  preview follows this rule. Scheduling/status checks use saved tax definitions;
  financial edits validate and calculate using current active definitions. Metadata
  and scheduling edits retain saved prices, totals and tax snapshots.
- Order schemas validate real dates, clock ranges, percentage discounts and bounded
  service/product/coupon/tax selections. Saved aggregate service durations up to
  12,000 minutes (20 x 600) remain parseable during edits. All persisted monetary
  totals/line amounts must fit the database Int range; overflow returns a business
  validation error before writes.
- Shared `order-time.ts` validates date/time against the supplied instant in tenant
  timezone. An instant-only PATCH derives its business date/time; date/time-only
  edits resolve a new instant and actually move the service lines. Contradictory
  fields, DST gaps and ambiguous local-only times are rejected. An explicit matching
  offset instant can distinguish the repeated hour. Metadata edits preserve existing
  dates; historical mismatches are not repaired by guessing. Timezone is checked
  again after the scheduling lock before an edit proceeds.

Verification: **172 distinct local checks passed**: 45 CRM/unit/architecture,
8 Workforce unit, 49 Appointments, 17 Inventory, 11 Services and 35 Workforce
integration checks, plus 7 local browser workflows. The first regression run caught
an overly broad time-merge return that overwrote unrelated PATCH fields; it was
restricted to the three time fields and all Appointments/Services checks passed on
rerun. A previous test expected zero prices to be replaced by a changed catalog price;
its expectation now asserts the intended explicit-zero behavior. New coverage checks
omitted/empty/default taxes, free lines, invalid references, inclusive penny rounding,
archived tax snapshots, invalid dates/times/percentages/overflow, tenant midnight,
partial scheduling edits and both DST transitions. Production build/TypeScript passed
(133 pages). Changed-file lint had no errors and only the existing tenant-screen hook
warning; whitespace passed. Local test database stopped afterward. No migration,
production query, client data change, push or deployment.

Remaining pricing work: the editor still contains a simplified coupon pricing
preview separate from server eligibility/stacking rules. Unify those calculations
and reconcile subtotal/discount display semantics (especially inclusive prices) in
one bounded follow-up; do not claim full preview/server parity yet. Existing saved
financial records remain unchanged. Workforce coordination, reverse order policy,
historical release reconciliation and R3-R5 are still pending.

## R2(d), batch 15: shared booking pricing preview (2026-10-17)

- Added a read-only pricing preview endpoint behind Appointments/read and current
  tenant/module authorization. Financial calculations use `resolveOrderData`, the
  same service used by order writes, including scoped coupons, stacking, minimums,
  dates, customer/global usage limits, tax defaults and inclusive rounding. Coupon
  hints now come from the same eligibility branches that apply or skip coupons.
- Validate an edited order in its tenant before excluding its usage; validate line
  ownership with the existing edit preparation helper. Financially unchanged inputs
  return saved line/tax/coupon totals, preserving metadata-only prices. No preview
  writes, locks, stock movements, audits, slot reservations or email delivery.
  Save continues to revalidate under the scheduling transaction.
- Removed duplicated browser totals/coupon rules and the obsolete form pricing
  helpers. Preview/save share payload construction. The editor debounces requests,
  skips incomplete selections, cancels obsolete requests, hides stale line/totals
  results and disables save until the current preview succeeds. Validation/network
  failures show an explanation and retry; notes do not trigger recalculation.
- Editor, read-only summary and invoice use one net-subtotal display helper. The
  subtotal already includes line discounts, excludes tax and precedes coupons;
  line discounts are informational, coupons subtract and tax adds once. Persisted
  financial columns remain unchanged. Invoice rates retain the quoted unit price
  and inclusive items are marked; discounted tax is not subtracted from the original
  rate. Product/service line previews now include coupon allocation and tax.

Verification: **178 distinct local checks passed**: 45 CRM/unit/architecture,
8 Workforce unit, 54 Appointments, 17 Inventory, 11 Services and 35 Workforce
integration checks, plus 8 local browser workflows. Added checks cover mixed-tax
preview/save parity, coupon skip reasons, usage limits, tenant/order/line isolation,
permissions, saved-price retention and absence of preview side effects. Browser
coverage verifies incomplete input, current-result save gating, delayed obsolete
responses, unavailable pricing, retry and the resulting saved amount. An initial
new-test name collision and missing browser fixture duration were corrected.
Production build/TypeScript passed (134 pages). Changed-file lint had no errors
and the existing tenant-screen hook warning; final targeted lint and whitespace
passed. Inspected the rendered mixed-tax invoice and browser totals screenshot.
No migration, hosted query, client data change, push or deployment.

**Open verification issue for the next Workforce batch:** the first combined
integration run reported RLS failures while inserting nested recurring-plan days/
breaks in two existing Workforce tests. All 35 passed on the separate rerun, but
that does not establish a root cause or resolve the intermittent failure. Reproduce
and investigate before claiming Workforce coordination or R2(d) complete. Evidence:
`tmp/r2d15-integration.log` (initial failures), `tmp/r2d15-workforce.log` (rerun).
Remaining reverse-order policy, historical reconciliation and R3-R5 are unchanged.

## R2(d), batch 16: leave/booking coordination and transaction completion (2026-10-17)

- Reproduced the batch-15 nested-plan RLS failure deterministically: after an
  interactive transaction timed out, Prisma continued its nested insert chain
  after ROLLBACK, outside the transaction-local tenant scope. The shared PostgreSQL
  adapter now rejects later queries as soon as COMMIT/ROLLBACK is queued or the
  transaction is released. The timeout test verifies rollback, reuse by another
  tenant and absence of leaked tenant/bypass settings. No RLS policy was weakened
  and transaction timeouts were not increased.
- Weekly and recurring plan saves/clones insert each hierarchy level in one batch,
  preserving parent-first RLS checks, sorting, atomic child replacement and existing
  IDs for the parent record. A full twelve-week plan and its clone each use five
  insert statements; a weekly plan uses four. Existing replacement-failure tests
  still verify rollback of children, displaced patterns and displacement audits.
- Leave review, cancellation, revocation and bulk review now use the scheduling
  transaction shared with bookings. Recheck status and manager/owner record scope
  after acquiring the lock; check booking conflicts inside that transaction.
  Leave conflict boundaries now follow tenant midnight instead of UTC midnight.
  Status changes, roster history and transition audits commit together; notifications
  run only after commit. Conflict-detail permission reads use the same connection.
- Transition validation remains an explicit business error. Unexpected review,
  cancel or revoke failures use the common safe server error rather than returning
  raw database messages as input errors. Submission rules are unchanged.

Verification: **192 distinct local checks passed**: 45 CRM/unit/architecture,
8 Workforce unit, 54 Appointments, 17 Inventory, 11 Services, 41 Workforce and
8 tenant-pool integration checks, plus 8 local browser workflows.
New coverage includes booking/approval concurrency, single/bulk
conflict rechecks after waiting, revoked manager scope, tenant midnight, all four
transition audit failures and twelve-week query counts. Production build/TypeScript
passed (134 pages). Targeted lint and whitespace checks passed. Recurring-plan and
leave-conflict/rescheduling screenshots were inspected; the local database was
stopped afterward.
The new audit test initially caught generic error handling and then an incomplete
rejection fixture; both were corrected before the successful full regression run.
No migration, hosted query, client data change, push or deployment.

## R2(d), batch 17: staff scheduling-mode coordination (2026-10-17)

- Moved mode-change validation, persistence and strict auditing into
  `modules/workforce/staff-scheduling-mode.ts`. User PATCH acquires the shared
  scheduling lock before the user-security tenant row lock, so a flexible plan
  cannot be added between a mode check and its write. Recheck the target role
  after waiting; changed roles require a refresh. Module/access checks run on the
  transaction client. Omitted/unchanged mode remains usable when Shifts is disabled.
- Existing active/future assignment, recurring-plan, weekly-plan and daily-slot
  guards now use the tenant calendar date/current Monday. UTC date-only storage
  remains unchanged. Existing plans and roster-history snapshots are not deleted
  or rewritten by switching modes.
- Mode changes require active/future appointments to be resolved first: scheduled/
  confirmed appointments whose end is still ahead, and all appointments still
  marked in progress. This conservative rule applies even if a booking might fit
  the other mode. Reassign or cancel through Appointments; changing mode never
  implicitly changes bookings or reveals customer details. Checks use bounded
  existence queries, not per-booking scans.
- Mode/profile/user edits and audit commit together. Unexpected user PATCH errors
  now use a safe server error; manager-selection validation keeps explicit input
  errors. The response rereads saved staff/eligibility details instead of returning
  the profile captured before nested changes. A repeated mode save adds no audit.

Verification: **180 distinct local checks passed**: 45 CRM/unit/architecture,
9 Workforce unit, 45 Workforce integration, 8 Users integration, 54 Appointments,
11 Services and 8 local browser workflows. New checks cover mode/plan concurrency,
bookings and revoked module allowance appearing while waiting, overdue in-progress
bookings, audit rollback of the entire user edit, saved response values, unchanged
mode idempotency, historical preservation and tenant date/Monday cutoffs across UTC
and DST boundaries. Production build/TypeScript passed (134 pages); targeted lint
and whitespace passed. The disposable local database was stopped afterward.
No migration, hosted query, client data change, push or deployment.
This batch completes the mode writer; weekly/recurring history
precedence and plan-change effects still need their separate implementation.
Inspection found that `roster-history.ts` currently derives Flexible history from
daily slots only, while live availability also reads weekly and recurring plans.
Unify that precedence with batched reads in the next batch; do not rewrite existing
client snapshots as an incidental side effect. Plan mutation auditing still uses
the shared API wrapper, except for transactional displacement audits; move complete
plan-change auditing alongside the owning write when implementing those effects.

## R2(d), batch 18: shared flexible availability and history (2026-10-17)

- Live appointment availability and roster-history generation now use
  `modules/workforce/flexible-availability.ts`. The shared resolver retains weekly
  plan -> active recurring pattern -> daily slot precedence, explicit off days,
  sparse-day fallback, validity bounds and cycles anchored to the pattern start.
  Leave and daily overrides retain their higher precedence in both callers.
- History includes weekly/recurring hours and deducts their breaks instead of
  recording only daily slots. Stored source/label remain SCHEDULE/Flexible, with
  OFF for nonworking dates; no schema or saved snapshot translation is needed.
  Equal-start recurring patterns have a stable ID tie-break after creation time.
- Weekly plans, recurring patterns and daily slots load in three scoped range
  queries (with bounded-depth Prisma child reads). History loads only Flexible
  staff IDs. Maps resolve each subsequent staff/date without additional queries;
  Standard staff incur no flexible-plan reads. Single-day live checks use the same
  loader rather than retaining a second query/calculation implementation.
- Normal history capture still inserts missing records only. Existing history is
  untouched; explicit affected-date corrections through the existing replace path
  continue to honor leave and overrides. No automatic retrospective repair or
  plan-change history rewrite was added.

Verification: **176 distinct local checks passed**: 45 CRM/unit/architecture,
9 Workforce unit, 49 Workforce integration, 54 Appointments, 11 Services and
8 local browser workflows. New checks cover weekly/recurring/daily precedence,
break deductions, cycle rollover, sparse fallback, off days suppressing lower
sources, preservation of saved snapshots, scoped date corrections, cross-tenant
isolation, query counts for single-day versus multi-week loads, and local midnight
on the preceding UTC date. Production build/TypeScript passed (134 pages); targeted
lint and whitespace passed. Disposable local database stopped afterward.
No migration, hosted query, client data change, push or deployment.
Plan-change effects and transactional plan audits remain next. Standard
schedule history still has a separate cycle/week-off implementation: review its
assignment anchor and default fallback before claiming complete scheduling parity.

## R2(d), batch 19: standard schedule availability and history (2026-10-17)

- Standard booking checks and history now use one tenant-scoped range loader.
  Rotation starts on the schedule start date; assignment dates select the schedule
  without restarting its cycle. Default schedules apply on individual unassigned
  dates before/after bounded assignments. An assigned off day (or a date before
  that schedule starts) suppresses default fallback.
- The roster screen uses the same pure rotation/week-off rules. Calendar dates are
  converted to UTC DATE keys before calculation, independent of server/browser
  timezone and DST. Empty secondary-week selections follow the existing save-time
  normalization (all weeks); specified week numbers remain selective. Latest-start
  assignments win, with a stable ID tie-break.
- Profiles, assignments and the tenant default load in batches with explicit tenant
  filters. Foreign, missing and Flexible profiles cannot inherit a Standard default.
  Each schedule's range is calculated once per load, including on the roster screen;
  resolving additional staff/dates adds no queries. Flexible-only history does not
  load Standard plans.
- Standard, Flexible and override working segments share break subtraction, clipping
  pauses to working hours and counting overlaps once. History paid minutes and roster
  display segments use those same rules. Leave and daily override precedence remains.
- Normal captures still insert missing snapshots only. Existing saved snapshots remain
  untouched; explicit corrections replace only the authorized dates. No migration or
  automatic repair of historical records was added.

Verification: **181 distinct local checks passed**: 45 CRM/unit/architecture,
11 Workforce unit, 52 Workforce integration, 54 Appointments, 11 Services and
8 local browser workflows. New checks cover rotation anchors, default fallback
outside assignments, off days suppressing defaults, breaks, schedule start bounds,
server/browser timezone and DST independence, tenant isolation, bounded range
queries and saved snapshot preservation with explicit affected-date corrections.
Production build/TypeScript passed (134 pages); targeted lint and whitespace passed.
Disposable local database stopped afterward. No migration, hosted query, client data
change, push or deployment. Plan-change effects/transactional audits and reverse
appointment/order policy remain next; R2(d) remains in progress.

## R2(d), batch 20: flexible plan booking safeguards and transactional audits (2026-10-17)

- Weekly plan saves/deletions and recurring plan saves, active clones, replacements
  and deactivations now compare effective availability before and after the write
  under the booking scheduling lock. Newly invalid appointments cause 409 and roll
  back the entire plan change, nested children and displacement audits. Staff must
  resolve bookings explicitly through Appointments; plans never move/cancel them.
- Checks cover all future scheduled/confirmed bookings and all work still marked
  in progress, including overdue work. They are not restricted to the advisory
  preview's 90-day horizon or the new pattern's validity: retiring an overlapping
  old pattern can affect its dates outside the replacement range. Weekly/recurring/
  daily precedence and breaks use the shared Flexible resolver; unchanged overrides
  and approved leave retain priority. Dates use the tenant timezone.
- Only availability regressions are blocked. Compatible changes and inactive
  drafts remain possible when unrelated pre-existing conflicts exist. Responses
  do not disclose customer details. Candidate booking reads use 200-row keyset
  pages and select only IDs/times; plan/leave/override reads are batched per page,
  not per appointment/day. No fixed result cap silently omits later bookings.
- A transaction helper rereads the current writer role, tenant status, custom
  permissions and Shifts activation after waiting for the lock. Displacement and
  activation permissions use that fresh actor. A Standard-mode staff member's
  dormant flexible pattern does not affect their Standard bookings.
- All these writes now save strict before/after audits in their owning transaction.
  Clone audits identify the new record and retain source identity. The API wrapper
  no longer performs duplicate snapshots or best-effort audits for these services.
  Repeated deletion of a missing weekly plan and repeated deactivation are no-ops
  without additional audits. Audit failures return the safe server error and roll
  back changes. Historical roster snapshots are not rewritten by these operations.

Verification: **188 distinct local checks passed**: 45 CRM/unit/architecture,
12 Workforce unit, 58 Workforce integration, 54 Appointments, 11 Services and
8 local browser workflows. New checks cover weekly save/delete and recurring
update/clone/deactivate/displacement rollback, bookings beyond the preview window,
override/leave precedence, pre-existing conflicts, local midnight, overdue work,
second-page bookings, safe error payloads, strict audit failure after displacement,
repeat no-ops and permissions/module/bookings changing while waiting for the lock.
Production build/TypeScript passed (134 pages); targeted lint and whitespace passed.
Disposable local database stopped afterward. No migration, hosted query, client data
change, push or deployment. Standard schedule/template/assignment safeguards,
explicit historical plan-correction semantics and reverse appointment/order policy
remain separate work. R2(d) remains in progress.

## R2(d), batch 21: standard schedule, assignment and template safeguards (2026-10-17)

- Standard schedule saves, deletion and assignment endings now compare effective
  availability before/after the change under the shared scheduling lock. Affected
  staff include removed assignments; default changes include all Standard staff in
  the tenant. Compatible default fallback is allowed. Valid active/future bookings
  cannot become unavailable, including far-future and overdue in-progress work.
- Shared template edits protect Standard assignments and daily overrides used by
  either scheduling mode, including changes to working hours and breaks. Inactive
  templates retain their existing assigned hours; normal selection still excludes
  inactive templates. Foreign template/assignment/schedule IDs remain inaccessible.
- Renamed the Flexible-only helpers to shared `planTransaction`, `auditPlan` and
  `protectPlanBookings`, with no compatibility wrappers. Candidate appointment
  queries use 200-row keyset pages scoped to affected staff, with no customer data;
  Standard/Flexible source reads remain batched. Pre-existing unrelated conflicts
  do not prevent compatible changes. Shared leave/override precedence is retained.
- Services recheck module access, role and permissions after acquiring the lock.
  Schedule saves recheck template-read permission; assignment endings retain the
  archive permission requirement. Template status transitions require archive.
- Main writes, child replacements, strict audits and default-displacement audits
  commit together. Wrapper snapshots/audits were removed for these services.
  Repeating the same assignment end date is a no-op without an additional audit.
- Shared history capture preserves existing snapshots and captures missing old
  hours before definition replacement. Template deletion checks schedules,
  overrides and saved history under the same lock; referenced templates should be
  deactivated. No automatic retrospective correction or migration was added.

Verification: **194 distinct local checks passed**: 45 CRM/unit/architecture,
12 Workforce unit, 64 Workforce integration, 54 Appointments, 11 Services and
8 local browser workflows. New tests cover schedule removal/staff replacement,
assignment cutoff/default fallback, default displacement, mixed-mode template
references, breaks, overdue/far-future bookings, history preservation and deletion,
strict audit rollback and permission/module/booking changes while waiting.
Production build/TypeScript passed (134 pages); targeted lint and whitespace passed.
Disposable local database stopped afterward. No migration, hosted query, client data
change, push or deployment. Daily override/slot mutation safeguards, explicit
historical plan corrections and reverse appointment/order policy remain separate
work. R2(d) remains in progress; R3-R5 are pending.


## R2(d), batch 22: daily overrides and Flexible slot safeguards (2026-10-17)

- Daily override and Flexible slot saves/deletions now use the same effective
  availability comparison as other plan mutations. A conflicting tentative write
  rolls back before a 409 response. Valid active/future bookings are protected,
  including overdue in-progress work. Compatible fallback and lower-priority
  daily edits remain allowed; pre-existing unrelated invalid bookings do not block
  repairs. Weekly, recurring, override and leave precedence is preserved.
- Daily mutations scope candidate queries to affected staff and padded UTC date
  bounds, then match exact tenant calendar dates. Candidate pages and source reads
  remain batched. The shared guard carries conflicting IDs internally; other plan
  APIs still expose only the safe conflict message.
- The roster helper catches booking conflicts only after rollback, rechecks
  Appointments disclosure rights and fetches details in batches only for authorized
  users. Existing conflict-resolution response fields remain available. Restricted
  users receive counts without booking/customer details. Deletion routes also
  return 409 consistently. Resolution remains a separate authorized Appointments
  action, never an implicit cancellation or move during roster changes.
- Daily writers recheck role/module/permissions under the scheduling lock, including
  template-read permissions and Flexible mode for slot saves. Before/after audits
  now commit with the roster and corrected history, replacing best-effort wrapper
  audits. Missing-row deletions and fully skipped ranges produce no mutation audit.
- Existing past daily corrections still replace only affected dates. Skipped dates
  stay untouched; history or audit failure rolls back the entire mutation. This
  batch adds no retrospective repair, new correction UI or database migration.

Verification: **201 distinct local checks passed**: 45 CRM/unit/architecture,
13 Workforce unit, 70 Workforce integration, 54 Appointments, 11 Services and
8 local browser workflows. New coverage includes exact-date query bounds, multi-day
rollback, deletion/default fallback, higher-priority sources, conflict redaction,
strict audit/history rollback, fresh permissions/mode/module checks and bookings
created while a writer waits. The existing midnight conflict fixture now starts
from valid availability, consistent with the shared regression-only policy.
Production build/TypeScript passed (134 pages); targeted lint and whitespace passed.
Disposable local database stopped afterward. No migration, hosted query, client data
change, push or deployment. Explicit historical plan-correction policy and reverse
appointment/order synchronization remain separate work. R2(d) remains in progress;
R3-R5 are pending.


## R2(d), batch 23: historical plan preservation and correction policy (2026-10-17)

- Before editing or removing an existing Flexible weekly plan or active recurring
  pattern, capture missing past roster snapshots using the old effective roster.
  Editing validity bounds captures the old range; activating a replacement or clone
  captures the entire displaced range, including dates outside the replacement.
  Existing snapshots stay unchanged. Draft and dormant Standard-mode plans do not
  capture unrelated history. New backdated records may populate missing history.
- The shared capture helper checks tenant/staff/mode, caps at tenant yesterday,
  merges overlapping/adjacent ranges without filling gaps, and processes at most
  366 dates per source-read/bulk-insert batch. Capture, plan mutation, booking checks
  and strict audit remain in the common scheduling transaction.
- Explicit historical corrections use existing daily overrides/slots and leave
  transitions. Only chosen dates are replaced with effective-source precedence,
  booking protection and an atomic audit. Ordinary plan edits do not silently
  rewrite saved history. No separate correction UI or retrospective repair added.
- Past roster display uses saved start/end bounds and paid minutes. Current template
  edits cannot alter historical totals. Existing snapshots do not contain exact
  historical break layouts, so those are not reconstructed from current templates.
  Current/future roster periods retain their live segmented display.


Verification: **206 distinct local checks passed**: 45 CRM/unit/architecture,
15 Workforce unit, 73 Workforce integration, 54 Appointments, 11 Services and
8 local browser workflows. New coverage checks bounded/merged history ranges,
saved display totals, weekly removal, recurring validity changes/deactivation,
active clone displacement, draft/dormant exclusions, explicit daily corrections,
and booking/history/audit-failure rollback. Production build/TypeScript passed
(134 pages); targeted lint and whitespace passed. Browser workflows passed;
no visual screenshot review is claimed.
Disposable local database stopped afterward. No migration, hosted query, client data
change, push or deployment. Next: reverse appointment/order synchronization.
R2(d) remains in progress; R3-R5 are pending.


## R2(d), batch 24: appointment/order synchronization (2026-10-17)

- Individual and bulk appointment reschedules/reassignments synchronize linked
  service-line staff, start/end and saved duration inside the same transaction.
  The order header uses the earliest service-line start (including retained
  historical lines), with its date resolved in the tenant timezone. Sibling slots
  are not moved implicitly. Resubmitting an unchanged service preserves saved
  quantity-based duration rather than replacing it with current catalog duration.
- Customer/service changes on a linked appointment must use the order editor so
  financial validation stays with the order. Linked started/completed/no-show
  schedules cannot be replaced. Activating work requires a confirmed parent order.
  Missing, foreign or ambiguous links fail closed; no repair/backfill is performed.
- Appointment cancellation/completion does not infer order cancellation/completion,
  change charges or coupons, or restock products. Those remain explicit order
  actions. Status-only appointment changes touch the order revision and produce
  an order audit with linked before/after snapshots. Repeated cancellation is a
  no-op. Main appointment and order audits commit or roll back together.
- One tenant-scoped parent/line lookup serves a batch (the API allows at most 100
  selected appointments); linked identity checks select at most two appointment
  IDs per line to detect ambiguity. Unlinked-only mutations skip these reads.
  Order/line writes are limited to affected records and share the scheduling lock.
- Single appointment, bulk resolution and order create/edit paths now share
  appointmentTransaction. It refreshes user/role, tenant state, module activation
  and action permissions after acquiring the lock. Child catalog/inventory checks
  use that fresh actor. Standalone creation also uses a strict transactional audit.


Verification: **214 distinct local checks passed**: 45 CRM/unit/architecture,
15 Workforce unit, 73 Workforce integration, 62 Appointments, 11 Services and
8 local browser workflows. New cases cover individual and multi-order schedule
synchronization, saved quantity/duration/prices, unchanged siblings, explicit order
status/stock actions, tenant-local midnight, ambiguous links, strict audit rollback
and authorization revoked while each booking writer waits. Production build and
TypeScript passed (134 pages); targeted lint and whitespace passed. Browser workflow
checks passed; no visual screenshot review is claimed.
Disposable local database stopped afterward. No schema migration, hosted query,
client data change, push or deployment. Next: R2(d) completion review before R3
common configuration. R2(d) remains in progress until that review; R3-R5 pending.


## R2 completion review (2026-10-17)

The review covers the local R2 implementation, not the production cutover.

| R2 requirement | Review outcome |
| --- | --- |
| CRM queries, reports, exports and import contracts | Extension-owned fields/columns remain behind explicit contracts; no industry implementation imports in core. Sales, import and scope suites exercise real tenant isolation. |
| Dashboard composition | Application installs module-owned providers/widgets; disabled or denied providers skip domain queries. Current module changes are exercised in local browser workflows. |
| Shared components and Sales Documents contracts | Removed pure CRM aliases have no runtime forwarding path. Permission-aware components remain explicit. Quotations preserve revision snapshots and exact payment totals. |
| Operational services | Inventory, Services, Appointments and Workforce own domain logic; HTTP routes have no direct database imports or raw transactions. Architecture tests enforce this boundary. |
| Booking/stock/workforce coordination | Shared working-time rules, booking guards, transactional scheduling changes, order/appointment synchronization and stock ledger behavior have database coverage. |
| Permissions after scheduling waits | Booking and coupon writers now share the same fresh access check, with their separate permission resources. Coupon create/edit/archive/status changes recheck current action permissions, role and module after waiting. |
| Data and migration scope | No table renaming, runtime compatibility layer, reseeding or client-data rewrite. The existing tenant-default schedule index migration is retained for R5; its isolated fixture passes. |
| Neutral wording | Stale salon-specific module commentary is removed. Stored identities, existing hosts, historical audit text and fixture identifiers are preserved. |

Review corrections:
- Coupon mutations now use appointmentTransaction with the coupon permission
  resource. Coupon-only managers retain their existing scope; booking access is
  not required. Strict audit and duplicate-code behavior remain unchanged.
- Added a route-boundary regression check and a blocked-writer coupon test.
- CRM core/import database fixtures now use the application's TenantPgAdapter,
  matching the other integration suites, instead of session-scoped PrismaPg.
  The first broad run had a concurrent-plan failure and stalled cleanup; the
  isolated plan test passed. Fixture alignment retains the original assertions
  and adds failure diagnostics; the full aligned rerun is the evidence below.

Scope retained explicitly:
- R3 owns resource-owned custom-field registration, contextual validation and the
  tenant terminology catalog/store/consumers. Existing custom-field semantics and
  required cohorts remain unchanged by R2.
- R4 owns remaining property-specific record-view props/composition and the final
  migration/reconciliation package. Core directories are not claimed to be wholly
  free of property-specific presentation yet.
- Inventory/Services catalog and leave-configuration wrappers retain their existing
  best-effort audit delivery. Strict transactional audit claims apply to the
  booking/plan/leave-transition paths documented in their batches, not every CRUD
  endpoint. R2 preserves those existing catalog semantics.
- Client-form version contracts, exact historical roster break layouts and live
  production-scale performance measurements are not introduced by this refactor.
- R5 still requires verified target identity, protected backup/restore rehearsal,
  pending historical migration fixtures, per-tenant reconciliation and controlled
  deployment. Local tests do not satisfy these production gates.


Review evidence: **445 distinct local checks passed**: 69 unit/architecture/date/
calculation checks, 191 operational/access/dashboard/pool/migration checks,
159 CRM/sales/import/custom-field/Real Estate/quotation checks, and all 26 local
browser workflows. Zero failures in the final runs. The concurrent-plan case also
passed three additional isolated runs (not counted again). Production build and
TypeScript passed (134 pages); targeted lint and whitespace passed.

Four fixture-dependent historical migration tests were skipped, not counted as
passes: activity upgrade, lead-intake upgrade, Real Estate choices upgrade and
additive projects upgrade. These require prepared older-schema fixtures in the
R5 rehearsal. The tenant-default schedule index fixture ran and passed.

Reviewed screenshots: mobile enquiry mapping, Leaves-only mobile dashboard,
mobile sales report and desktop sales report with Real Estate disabled. Controls
and content remained within the viewport; module-off reporting retained core sales
records. This is selected-screen visual review, not complete UI acceptance.

**R2(a-d) is complete locally.** No hosted query, client data/configuration change,
production migration, push or deployment occurred. The disposable local database
was stopped. Next is R3(a): resource-owned custom-field registration and contextual
validation, preserving current IDs, values, required cohorts and permissions.


## Next batches

- Start R3(a): move custom-field registration to application composition and
  define resource-owned module/permission/context validation. Retain the current
  typed tables, field IDs, values, SALES conversion cohorts and requiredSince rules.
- Then implement the shared terminology catalog/store/resolver and integrate the
  explicitly supported labels across current screens, imports, exports and newly
  generated documents. Preserve historical revisions and stable storage keys.
- Remaining record-list/editor/work-view project-specific props and industry
  composition are tracked for the R4 view-extension cleanup. Do not claim the
  entire CRM directory is already industry-neutral.

No push or deployment before R5.
