# ERP standardization

## First increment - 2026-10-03

The GitHub repository is renamed to `alvinleigia/ls-erp`, preserving repository
ID 1279282190. Local origin points to the renamed repository. Package identity
and structured log service name are `ls-erp`; the application title remains
Leiweissen ERP. Existing test-account email addresses and historical deployment
references are identifiers, not branding, and remain unchanged.

The working directory remains `C:/xampp/htdocs/ls-salon` for this active workspace.
The Vercel project and live tenant domains are separate hosting identifiers; this
increment does not change tenant URLs or authentication configuration.

Vercel Git reconnection was completed by the user and verified on 2026-10-03:
project `prj_qY27BxXafWCTenEyiYArTrxTQ0tR` links to `alvinleigia/ls-erp`,
repository ID 1279282190, production branch `main`. The Vercel project display
name is still `ls-salon`; no application deployment was made.

Invitations and appointment invoice email/PDF defaults use the resolved tenant
name. Empty names fall back to Leiweissen ERP. Tenant names and invitation links
are HTML-escaped in email templates. Existing INVOICE_HEADER_LINES is only a
legacy fallback for PDF callers that supply no tenant name. Email delivery still
requires the configured MAIL_FROM address; no invented sender domain is used.

## Shared UI

`components/erp` now owns page headers, sections, surfaces, filters, controls,
server-backed record selectors, pagination, record tabs, read-only fields,
menus and focused edit panels. CRM entry points delegate to these components.
CRM action/tab/link permissions stay in the CRM adapters. Access-role settings
uses the neutral components directly without depending on CRM presentation.

This is an extraction of the tested layout, not a completed rewrite of the
legacy Inventory, Services, Appointments, Leaves or Shifts screens. No schema
migration is required for this increment.

## Following increments

1. Complete Phase 2: adopt the shared UI in Inventory, then Services,
   Appointments, Leaves/Shifts, and Dashboard/Reports. Preserve workflows,
   server pagination and indexed queries; test each module before rollout.
2. Continue Phase 3: extend module allowances and API action permissions to each
   remaining legacy module after documenting its dependencies and preserving
   existing tenant access. Retain the Inventory access work already implemented.
3. Continue the access-control record-scope work in TENANT_ACCESS_CONTROL.md.
   Moving presentation components does not grant additional record access.

Live domain migration needs its own host-routing, authentication and email-link
cutover plan. Do not replace hostnames or persisted identifiers by global search
and replace.

## Validation

Production build, TypeScript and targeted ESLint passed. All 30 intercepted
browser regressions and 20 permission/navigation unit checks passed. Mobile
role and project edit-panel screenshots were inspected. Tenant invitation
branding, fallback and HTML escaping were checked without sending email.
Code changes are committed locally only; the GitHub repository rename and origin
update are complete. Push and deployment remain pending. No migrations or business-data changes were required.

## Phase 3 - Inventory activation and access (2026-10-03)

Inventory is the first legacy module moved behind the shared module and access
catalogs. It is independent of CRM. Platform administrators allow it in tenant
module settings; tenant administrators enable/disable it at Settings > Modules.
Settings > Access roles now includes Products and stock, Categories, Suppliers
and Purchase orders. Existing ADMIN/MANAGER authority remains the upper bound;
access-role assignments can narrow it but do not promote STAFF accounts.

- Every Inventory list/write API resolves the current active user and assigned
  role, checks both module layers, and executes inside explicit tenant RLS context.
- Lists retain database pagination. Authorization uses one indexed current-user
  lookup and a tenant-scoped module lookup per request, not one query per row.
- Create, edit and archive permissions are independent. Status changes, including
  reactivation and creating inactive records, require archive permission. Existing
  delete/linked-record restrictions are preserved.
- Receiving a purchase additionally requires Products and stock: edit. Appointment
  product lines require product read; stock deduction/restoration requires product
  edit and an enabled Inventory module. Service-only/no-stock operations continue
  without Inventory. Historical booking invoices remain readable.
- Disabled or inaccessible Inventory views do not mount their lists. The sidebar
  lists only permitted views, and forms/action menus disable denied actions.
  Dashboard low-stock queries are skipped when Inventory/product read is denied.
- Seed/clear maintenance cannot bypass Inventory activation. Assigned restricted
  roles cannot run the broad maintenance endpoint, which also modifies users and
  other domain data. Unassigned legacy administrators/managers retain maintenance
  access. No hosted seed/reset scripts were run.
- Inventory mutations record actor, request ID and before/after record snapshots
  through the existing best-effort domain audit helper. These legacy mutations
  have not been converted to atomic mutation-plus-audit transactions. Module and
  access-role configuration retains its existing transactional audit behavior.

Migration: `20261003090000_inventory_module`. Existing tenant Inventory access is
backfilled as allowed/enabled; pre-existing Inventory decisions are preserved.
New tenants remain denied until explicitly provisioned/allowed. The migration
changes configuration only and does not delete business records. Deploy this
migration before the application update to preserve existing Inventory access.

Validation: production build, TypeScript and targeted ESLint; 13 Inventory/RLS,
stock and migration checks; 5 module integration regressions; 30 unit checks;
4 intercepted browser checks covering disabled, denied, read-only and editor
views. Integration tests used disposable PostgreSQL 16 with a non-bypass runtime
role. Browser tests used intercepted fixtures, not hosted records.

This completes the Inventory increment of Phase 3, not all legacy modules.
Sequencing correction: shared UI adoption belongs to Phase 2 and is not complete.
Return to Phase 2 before extending access boundaries to Services. The Inventory
access implementation above is preserved; it does not complete Phase 2.
Application changes and the new migration are local; not pushed or deployed.

## Phase 2 - Inventory UI adoption (2026-10-03)

Phase 2 is in progress. Inventory products, categories, suppliers and purchase
orders now use the neutral ERP components already shared with CRM:

- Shared page headers, table surfaces, search/status controls and pagination:
  record range on the left, previous/next centered, page size on the right.
  Search, status, sort and page-size changes return to page one. Lists remain
  server-paginated; superseded requests are cancelled.
- Clicking a record opens a read-only panel. Editing uses a separate shared
  draft panel with named sections, fixed Save/Cancel actions, inline save errors
  and confirmation before discarding changes.
- Product, category and supplier selectors search the server instead of loading
  only the first 100 records. Existing selected links remain visible in edits.
- Shared dropdowns and checkboxes replace native form controls. Delete and stock
  receiving actions use a common confirmation dialog.
- Supplier and purchase notes are included in API responses. Editing another
  supplier field preserves its existing notes instead of clearing them.

Inventory activation, access permissions and stock operations from the prior
increment remain in place. This UI increment requires no additional migration;
the previously prepared Inventory activation migration is still pending rollout.
Browser checks use intercepted local fixtures and database checks use disposable
local PostgreSQL; hosted records were not changed.

Validation: production build, TypeScript and targeted ESLint passed. Four
Inventory workflow browser checks and 34 CRM/access browser regressions passed,
along with all 13 Inventory/RLS/stock/migration integration checks. Desktop list
and mobile product-edit screenshots were inspected; the mobile footer fits the
viewport and remains visible while form sections scroll.

Inventory checkpoint: next implementation increment was Services UI adoption,
completed below. No push or deployment.

## Phase 2 - Services UI adoption (2026-10-03)

Services (including packages) and Service categories now use the shared ERP page
headers, surfaces, dropdowns, filters and centered pagination. Saved records open
in read-only panels; separate draft panels provide fixed Save/Cancel actions,
discard confirmation and visible save errors without losing entered values.
Service forms group details, pricing/duration, taxes and package items into
sections. Deletion uses the shared confirmation dialog and preserves existing
API behavior for linked records.

Category and package-service selectors search the server in bounded requests,
replacing the first-100-record preloads. Existing package selections remain
visible even when absent from current search results. Search, filter, sort and
page-size changes reset pagination; superseded list requests are cancelled.
Computed tax columns no longer expose unsupported server sorting. Currency,
tax calculations, package payloads and existing administrator/manager access
rules are preserved. Services module activation/access expansion remains Phase 3.

Validation: production build, TypeScript and targeted ESLint passed. Four local
browser workflows passed, covering category creation/discard/pagination, inclusive
taxes and mobile edits, failed saves with retained drafts, package search and
selection preservation, service creation, filtering and blocked deletion.
Desktop list and mobile edit screenshots were inspected. Browser APIs were
intercepted; hosted records were not modified. No schema/API changes or additional
migrations were required. Changes are local, not pushed or deployed.

Phase 2 remains in progress. Next: Appointments, then Leaves/Shifts and
Dashboard/Reports.

## Remaining name-reference audit (2026-10-03)

Active package, application and log identity already uses LS ERP / Leiweissen ERP.
The local example environment file's invoice label and example database name now
use ERP naming. Keep the following references until their own migration:

| Reference | Treatment |
| --- | --- |
| `@ls-salon.test` seed and login emails | Keep stable; changing them can create duplicate accounts or invalidate test logins. |
| `ls_salon_crm_test` | Keep the exact disposable-database guard aligned across scripts and tests. |
| Historical deployment URLs and release records | Preserve as evidence of the deployment tested. |
| `salon.leigia.com` and tenant subdomains | Separate DNS, tenant-routing and authentication cutover. |
| `C:/xampp/htdocs/ls-salon` | Current workspace path; rename only after releasing the Windows file lock and reopening the workspace. |
| Vercel project display name | Stable project ID remains linked; no hosting rename or deploy performed in this increment. |


## Phase 2 - Appointments UI adoption (2026-10-03)

Appointments and coupons now use the shared ERP page headers, table surfaces,
filters, dropdowns and pagination. Appointment customer links open read-only
information; saved booking orders open a summary with stored service/product
prices, discounts, taxes, scheduled times and totals. Editing uses the shared
sectioned draft panel with fixed actions and discard confirmation. Historical
bookings remain read-only. Missing bookings show an error instead of blank edits.

Booking details appear before service/product items in both visual and keyboard
order. The shared time picker uses dropdown controls in 12- and 24-hour modes.
Shared panel footers support additional actions and wrap on narrow screens;
booking drafts retain separate Save draft and Confirm booking actions. Failed
saves retain input and show errors, including availability suggestions. Invoice
printing and email actions remain available on saved booking summaries.

Coupons have separate read-only and edit views, with discount, eligibility and
validity sections. Cancellation and coupon deletion require shared confirmation
dialogs. Existing API payloads, pricing/tax calculations, stock side effects and
role checks are preserved. No backend or schema changes were made in this UI
increment. Existing capped booking/coupon lookup preloads remain a separate
follow-up; this increment does not claim full server-backed selector adoption.

Phase 2 remains in progress. Next: Leaves/Shifts, then Dashboard/Reports.
Changes remain local, not pushed or deployed.

Validation: production build (including TypeScript), standalone TypeScript and
targeted ESLint passed. All 14 distinct Appointments/Inventory/Services browser
workflows passed across the final runs. The new-booking test initially raced a
closing dropdown's focus restoration; after awaiting restored focus, it passed
three consecutive runs. Tests cover draft/confirmed payloads, retained values on
conflict, suggestions, historical/missing bookings, coupon eligibility, deletion
confirmation, pagination, 12-hour input and 320/390px layouts. Desktop list and
mobile edit screenshots were inspected. APIs were intercepted locally; no hosted
records, invoice emails or database fixtures were changed. Syncfusion was disabled
in the local harness, so enabled calendar interactions require a hosted check.


## Phase 2 - Leaves and Shifts UI adoption (2026-10-03)

Leaves definitions, groups, requests and approvals, plus shift templates,
schedules, recurring plans and the roster, now reuse the shared ERP page headers,
sections, surfaces, dropdowns and centered pagination. Extra definition and
recurring-plan filters are grouped. Existing list APIs remain server-paginated.

Saved definitions, groups, templates, schedules and recurring plans have
read-only summaries with separate sectioned edits. Recurring summaries load
weekly slots and breaks only when opened and cancel obsolete detail requests.
Draft panels keep actions visible, confirm discard, retain input on failed saves
and reset discarded creation forms. Definition/group creation keeps page-level
Save/Cancel actions and now surfaces save errors inline.

A neutral shared timeline now serves CRM and leave request history. Shared
workflow dialogs keep confirmation actions visible while long content scrolls.
Approval/rejection, bulk actions, cancellation/revocation, appointment conflicts,
shift breaks, schedule assignments, recurring impact previews and roster
overrides retain their existing API contracts. Reviewed leave requests can still
open their details after leaving Pending/Approved status; mutation actions remain
status-gated. Roster memo dependencies were corrected so override changes refresh
the derived calendar events.

Validation: 13 new intercepted browser workflows passed, covering saved rules,
staff assignments, failed saves, discard, creation, request history/cancellation,
approval conflicts/rejection, pagination, staff controls, weekly availability and
mobile roster overrides. All 21 CRM record regressions passed across runs; one
initial access-loading timeout passed on rerun. The harness now mirrors static
leave routes alongside record IDs. Desktop list, mobile group editor, roster grid
and override-dialog screenshots were inspected. Targeted ESLint passed without
warnings. Production build and final type checking are recorded below.

No API/schema changes or additional migrations are needed for this increment.
All browser API requests were intercepted; no hosted records or notifications
were changed. Existing capped leave/staff/template lookup preloads remain a
follow-up, as does enabled Syncfusion calendar verification (disabled in the
local harness). Module activation/access expansion remains Phase 3.

Phase 2 remains in progress. Next: Dashboard/Reports. Changes remain local;
not pushed or deployed.

Final verification: Prisma Client generation completed; the final production
Next.js build exited 0, standalone TypeScript exited 0, and targeted ESLint
reported no errors or warnings. The last browser run passed all 13 Leaves/Shifts
checks plus the previously timed-out CRM check (14/14); the remaining 20 CRM
record checks passed in the preceding run. Git diff whitespace validation passed.


## Phase 2 - Dashboard and Reports UI adoption (2026-10-03)

The dashboard now uses the shared ERP header, surfaces, section cards and period
dropdown. Custom dates are applied only when both endpoints are present. Refresh,
loading and inline errors make failed requests distinct from successful results;
obsolete summary requests are cancelled. Existing metrics, chart data, monetary
formatting and dashboard API access remain intact. Tables scroll within their
sections on narrow screens; bounded summary samples are not given fake pagination.

Coupon usage and Audit logs now share ERP toolbars, grouped filters, dropdowns
and centered pagination with counts on the left and page size on the right.
Changing filters/page size resets the page, and list requests remain server-paged.
Obsolete requests are cancelled; failures clear results and display an error.
Audit entries open in a read-only sectioned panel with fixed Close controls and
internally scrolling JSON snapshots. Existing report role guards and API contracts
are preserved; no new API/schema changes or migrations were introduced here.

Validation: production build (including TypeScript) and targeted ESLint passed.
Four intercepted browser workflows passed, covering dashboard date selection and
metrics, mobile error recovery, report filters/paging, and audit snapshot panels.
The chart screenshot check also passed after waiting for SVG animations to settle.
Desktop dashboard/report and mobile date-picker/audit screenshots were inspected.
Tests use isolated local API fixtures; they do not verify hosted authentication or
change hosted business records.

This finishes the named Phase 2 UI adoption increments locally: Inventory,
Services, Appointments, Leaves/Shifts, and Dashboard/Reports. It is not completion
of all ERP modernization or hosted acceptance. Existing capped lookup selectors
in Appointments/Leaves/Shifts and enabled Syncfusion verification remain tracked
follow-ups. Next: Phase 3 Services/module activation and access expansion, retaining
the Inventory access work already completed. No push or deployment was performed.


## Phase 3 - Services activation and access (2026-10-04)

Resumes Phase 3 after the named Phase 2 UI increments. Inventory activation/access
remains in place. Services is now an independent module, with Services and packages
and Service categories resources. It does not require CRM or Inventory.

Configuration uses the existing controls:
- Platform administrator: Settings > Tenants > tenant module allowances > Services.
- Tenant administrator: Settings > Modules > Services activation.
- Tenant administrator: Settings > Access roles > Services and packages / Service
  categories, with separate Read, Create, Edit and Archive permissions.

The existing ADMIN/MANAGER boundary remains; assigning permissions cannot promote
STAFF into catalog management. Administrators and unassigned legacy managers keep
their existing authority. Assigned restricted roles require explicit Services
permissions. Changing category requires category Read permission; retaining the
existing category during a service edit does not require opening that view.
Status changes (including creating inactive records and reactivation) require
Archive, independently of Create/Edit. Navigation uses the first permitted view;
disabled/denied views do not mount their catalog requests. Editors without Archive
cannot change status, and read-only records expose no edit action.

Catalog APIs recheck the current active user and module allowance/activation,
then run inside explicit tenant database context. Lists retain server paging;
authorization is constant per request, not per result row. Service/package/tax
and category changes record actor, request ID and before/after snapshots through
the existing best-effort domain audit helper, matching Inventory. These catalog
mutations are not yet atomic mutation-plus-audit transactions.

Dependency behavior:
- Booking service-line resolution, legacy appointment creation, availability,
  rescheduling and reactivation require enabled Services and service Read access.
- Saved bookings and invoice PDFs remain readable when Services is disabled.
  Legacy appointment cancellation remains available; order edits still resolve
  service lines and require Services access.
- Staff eligibility changes validate activation and tenant-owned service IDs.
  Existing administrator-only eligibility authority remains. Eligibility changes
  are transactionally audited. Disabled Services hides the eligibility controls
  and omits that field from unrelated profile saves.
- Maintenance seed/clear operations cannot bypass Services activation, including
  implicit service-catalog seeding for appointments. Dashboard catalog counts are
  skipped when Services/read is unavailable; saved booking summaries stay readable.

Tests exposed existing issues in these paths: service tax edits used unsupported
nested writes inside updateMany; tax links now update in the same transaction.
Service deletion now considers appointment/order-line and staff eligibility
references, retaining linked services as inactive. Saved booking/order/invoice
readers now establish tenant context; appointment audit entries now include tenant
ID so RLS permits the audit record.

Migration: 20261003100000_services_module. Like the preceding Inventory migration,
it enables/allows Services for existing tenants without overwriting explicit
choices. Newly provisioned tenants require explicit allowances. Apply pending
migrations in order (Inventory, then Services) before deploying this application.
No hosted migration, seed, business mutation, push or deployment was performed.

Validation: production build, standalone TypeScript and targeted ESLint passed.
Ten new local integration/migration checks passed with actual PostgreSQL RLS and
non-bypass runtime authorization; only authentication was stubbed. Twelve browser
checks passed (eight permission scenarios plus four existing service workflows).
Desktop permission controls and mobile editor screenshots were inspected. Existing
Inventory, module/access, navigation, Users and Dashboard regression checks passed
across runs. The older Dashboard test teardown was updated to remove its own
project-choice fixtures before deleting its disposable tenants.

Services activation/access is complete locally. Next Phase 3 increment:
Appointments activation and its broader action permissions, with explicit Services
and optional Inventory dependencies. The earlier capped lookup and hosted calendar
verification follow-ups remain; this increment does not claim those complete.


## Phase 3 - Appointments activation and access (2026-10-04)

Appointments now uses the existing platform allowance / tenant activation model,
independently of CRM. Resource permissions distinguish bookings/calendar
(read/create/edit/archive/export) from booking coupons (read/create/edit/archive).
Existing ADMIN/MANAGER ceilings remain; custom roles narrow those permissions.
Navigation uses the first permitted view. Direct pages, APIs, dashboard summaries,
coupon reports and appointment/coupon audit snapshots respect activation/access.
The new-booking page requires create permission. API wrappers recheck the current
active user and establish tenant DB context; authorization does not run per list row.

Cancellation and reactivation require Archive; ordinary changes require Edit.
Invoice PDF requires Export; emailing additionally requires Edit. No invoice email
was sent during verification. Bulk cancel/reassign/reschedule use corresponding
permissions. Calendar remains read-only for drag/drop as before; create/edit/cancel
controls follow the same permissions as the list. Services must be enabled/readable
for service creation/rescheduling/reassignment. Inventory is needed only for product
lines. Applying coupons requires coupon Read. Editing existing orders re-resolves
their service/product/coupon dependencies and therefore requires their access too.

Appointments has no hard activation dependency on Services: disabling Services
preserves booking history, invoice export and appointment cancellation. Disabling
Appointments blocks its own views/APIs while retaining stored records. Dashboard
booking queries are skipped when the module or Read permission is unavailable.
Maintenance seed/clear cannot bypass the module. Internal leave/shift conflict
checks remain enforced even when Appointments is unavailable; booking details in
conflict responses are withheld without Read permission. Counts remain available
for scheduling integrity. Further Leaves/Shifts permission expansion is next.

Coupon eligibility changes validate tenant-owned IDs and the relevant catalog
access. Used coupons are deactivated on delete, preserving code-based snapshots
and usage history. New booking-order/coupon mutations and invoice-email events
include actor/request and before/after audits. Bulk appointment audits now include
tenant ID and before snapshots. These retain the existing best-effort audit policy;
this is not an atomic mutation-plus-audit redesign.

Migration: 20261004090000_appointments_module. Existing tenant access is preserved
without overwriting explicit choices; new tenants require platform allowance.
Apply pending Inventory, Services and Appointments migrations in order at rollout.
No hosted migration, business mutation, push or deployment was performed.

Validation: nine local PostgreSQL/RLS integration and migration tests passed,
including denied endpoints, tenant isolation, current-role checks, separate actions,
nonempty dashboard suppression and audit-report filtering. Twenty-five existing
Services/Inventory/Dashboard integration checks and four access/navigation tests
passed. Sixteen intercepted browser workflows passed; two focused screenshot
checks were repeated with animations disabled. Desktop read-only booking and mobile
coupon editor screenshots were inspected. Existing capped lookups and enabled
Syncfusion hosted-calendar verification remain follow-ups.

This completes the Appointments increment locally. Next: Phase 3 Leaves/Shifts
activation and access controls. Changes and pending migrations remain local.

Appointments final verification: production Next.js build exited 0; standalone TypeScript, targeted ESLint and whitespace checks passed. The disposable local test database container was stopped. Changes remain local.


## Phase 3 - Leaves and Shifts activation/access (2026-10-04)

Leaves and Shifts now use independent platform allowances and tenant activation.
Migration 20261004100000_workforce_modules preserves existing tenant access and
explicit decisions; new tenants start with neither module allowed. Apply after
the pending Inventory, Services and Appointments migrations. Nothing was applied
to the hosted database, pushed or deployed.

The permission catalog separates personal requests (Read/Create/Archive), approvals
(Read/Approve/Archive), definitions, groups, templates, schedules and recurring
plans (Read/Create/Edit/Archive), and roster overrides (Read/Edit/Archive).
Archive covers cancellation, revocation, unassignment and deactivation as
appropriate. Current ADMIN/MANAGER ceilings remain; STAFF can manage only their
own permitted requests. Managers still approve only direct-report STAFF requests,
not their own. Approved-leave roster queries now follow that same manager scope.

All workforce endpoints use the current active database actor and explicit tenant
context before domain queries. Module and action checks run per request, not per
row. Navigation uses the first permitted view. Direct routes and create routes are
guarded; shared control hooks disable unauthorized actions/status changes.
Personal requests do not require permission to browse leave configuration.

Related lookups require their own Read permission when assigning definitions to
groups or templates to schedules/overrides. Roster lookups skip unavailable data
and explain that the display is partial. Saved schedules and approved leave still
constrain internal appointment availability even when their modules are disabled.
Booking conflict details remain redacted without Appointments Read; conflict
counts still protect scheduling integrity. Resolving a booking conflict requires
the corresponding appointment action and applicable Services access.

Changing staff scheduling mode also requires Shifts/Edit roster access; unrelated
staff edits preserve an omitted scheduling mode. Creating a recurring plan cannot
use Edit permission. Replacing overlapping active plans additionally requires
Archive and logs the affected plan IDs. Replacing the default schedule requires
Edit on schedules. Workforce configuration mutations record actor/request and
before/after snapshots; leave workflow audits now explicitly include tenant ID.
Most domain audits retain the existing best-effort policy, not a new atomic-audit
guarantee. Replacement-plan and scheduling-mode audits run in their transaction.

Dashboard pending-leave counts honor module/Read permission and manager scope.
Audit pagination/counts filter denied workforce resources before querying. Generic
leave-request audit snapshots are restricted to administrators; managers/staff
retain authorized request detail timelines. Maintenance seed/clear checks include
workforce dependencies and cannot bypass disabled modules.

Validation: 10 local PostgreSQL/RLS integration and migration tests pass, including
all exported endpoint denials, current-role checks, tenant isolation, ownership,
manager scope, related permissions, archive transitions, plan replacement,
profile mode preservation, nonempty dashboard/audit filtering and migration
idempotence. 34 related Appointments/Services/Inventory/Dashboard tests also pass.
All 36 intercepted browser checks pass (34 initially; two approval checks rerun
after correcting the mock session response). Mobile leave-group and desktop
shift/readonly-approval screenshots were inspected. No real notification was sent.
TypeScript, targeted ESLint and whitespace checks pass. Production compilation,
TypeScript and all 127 static pages completed; final native exit verification is
recorded below.

This completes the Leaves/Shifts increment locally. Next: Phase 3 review of the
remaining Dashboard/Reports, Users and Settings access boundaries; broad record
scope expansion remains separately planned in TENANT_ACCESS_CONTROL.md. Existing
capped lookup and enabled Syncfusion hosted-calendar verification follow-ups remain.

Workforce final verification: production Next.js build exited 0; targeted ESLint and whitespace checks passed, alongside the four access-policy/navigation tests. Local database tests and browser harness used isolated/mocked data only. No push, deployment or hosted migrations.


### Phase 3 - Core administration boundaries (2026-10-04)

Dashboard, audit reports, user directory, business settings and tax configuration
now have separate access-role permissions. These are shared core capabilities,
not tenant-disableable modules; tenant administrators retain full access. Existing
custom roles need the appropriate new read permissions explicitly granted.
User creation, invitations, role/security changes and staff administration remain
administrator-only. Active staff, managers and customers retain basic self-profile
access without directory access. Current database account/tenant state overrides
stale session role claims on these APIs and business layouts.

Shared core guards, route requirements, navigation filtering and action controls
are reused. Settings and user-detail GET requests no longer create configuration
or staff rows. Business settings and tax writes record before/after audit snapshots;
invitation audits exclude tokens. Tax activation/deletion requires Archive in
addition to Read; Edit alone cannot change status.

Booking/workforce forms use paginated, tenant-scoped directory projections;
catalog/booking forms use a tax lookup; scheduling uses operational settings and
other screens use display preferences. These avoid granting full Users/Settings
access just to fill a dropdown. Existing 100-row client lookup caps remain a
separate follow-up. The audit report applies source permissions/module activation
before count and pagination. Managers see recognized authorized operational
resource events only; security, CRM, unrecognized events and scoped leave-request
snapshots remain excluded from that generic report. Relevant record timelines
remain the place for scoped history. Dashboard staff counts require Users Read.

Validation: 46 core/workforce/appointments/services/inventory database tests pass
(44 initially, two legacy dashboard fixtures updated for the new Dashboard Read
permission and rerun within 21 passing inventory/services tests). An additional
18 Users/Settings tests, four Dashboard tests, six access-role integration tests
and four policy/navigation tests pass. All 34 selected intercepted browser checks
pass (33 initially; one form-navigation timeout passed on isolated rerun).
Read-only Settings and restricted tax-editor screenshots inspected. Targeted
ESLint passes. No live email, hosted data changes, commit, push or deployment.
No new migration is required for this increment; earlier module migrations remain
local. Next: separately planned record-scope expansion in TENANT_ACCESS_CONTROL.md.

Core final verification: production Next.js build exited 0 after retrying a transient Google Fonts connection failure. Build TypeScript and prerendering passed; targeted ESLint and whitespace checks passed. The disposable local test database was stopped.


## Phase 3 - CRM sales record scopes implemented locally (2026-10-04)

Settings > Access roles now includes CRM sales record scope: Existing account
access, Own / assigned records, Own and managed sales teams, or All tenant records.
Existing roles retain account-based behavior. Tenant ADMIN remains tenant-wide;
STAFF remains within assigned-record access even if a broader scope is selected.
Manager accounts can be narrowed through the role. Action permissions still apply.

In CRM > Configuration > Sales teams > Members, a tenant administrator can set
Team access to Team manager for an active Manager account. Ordinary membership
does not grant authority. A managed scope covers records explicitly assigned to
that sales team, plus the manager's own records; it does not expose every record
owned by a member. Role changes, manager revocation and team archival take effect
on subsequent requests without another login. Changes are versioned and audited.

Shared predicates cover enquiries, opportunities, related contacts/accounts,
activities/internal history, quotations/PDF access, selectors, counts, reports and
exports before pagination/aggregation. Parent/referral labels remain masked when
outside the scope. Existing customer-facing completed interaction summaries stay
shared for an accessible contact; private work details/history remain scoped.
Edits retain the record owner and audit the actual manager. Former team members'
visible activities remain attributed in reports; existing assignments may be
preserved on edit, but new assignments still require an allowed active assignee.
Project access, configuration permissions and other ERP module record scopes are
unchanged by this sales-specific setting.

Migration 20261004110000_crm_record_scopes adds TenantAccessRole.crmRecordScope
(default ACCOUNT_ROLE, checked values) and CrmSalesTeamMember.isManager (false).
It rewrites no ownership and promotes no existing members. Apply this and the
pending earlier module migrations BEFORE deploying code that selects these
columns. Only the disposable local database has received this migration.

Validation: 126 database tests passed, including the new scope/migration suite,
CRM, teams, sales reporting, quotations, roles and core boundaries. Two existing
legacy migration checks remain skipped (activity upgrade and lead-source intake).
One contention failure in the parallel run passed in isolation; the complete
serial rerun passed. Thirty unit/policy checks and five intercepted browser checks
passed. Role desktop/mobile and team-manager screenshots inspected. The managed
scope returns five of 10,000 records in 13 SQL statements; authorization is loaded
once per operation, with no per-row permission queries. Production build and
TypeScript passed; targeted ESLint and whitespace checks passed.

Run the new suite with npm.cmd run test:crm:scopes:integration, using only the
local CRM_TEST_DATABASE_URL described in the test guard. No hosted writes,
commit, push or deployment. Next: the separately planned audit-review and rollout
increment; this milestone does not claim additional ERP record scopes are done.


## Phase 3 - protected audit review implemented locally (2026-10-04)

This completes the audit-review portion of access-control Stage 4; hosted rollout
remains pending. Reports > Audit logs now provides All permitted / Business /
Security event filters, exact actor and record IDs, request ID, entity type,
validated UTC date bounds and search. Standard server pagination and shared
read-only panels remain in use. View shows actor, target, timestamp, request ID
and a field-by-field Before/After comparison. Recorded snapshots are expandable.
Partial audit patches do not imply that omitted fields were deleted.

The list selects summaries only. A separate detail GET repeats current access
checks and returns recursively redacted credential fields, leaving stored audit
rows unchanged. Reload/focus clears previous details while rechecking access;
denied requests cannot fall back to the old snapshot. Neither endpoint mutates
business data. Current actor permissions, module flags, count and rows use one
repeatable-read database transaction for a consistent authorization snapshot.

Tenant administrators can review security changes, including access roles,
assignments, team-manager designations and module allowances/activation. Managers
require Audit reports Read plus the underlying operational resource Read and
module activation. They receive only the previously supported operational event
families. Generic CRM/security/unknown audit snapshots remain excluded for
managers regardless of CRM record scope; the existing scoped CRM record timelines
remain available. Disabled modules hide domain audit payloads from administrators
too, while security changes remain reviewable. Historical saved payment schedules
retain the established Sales Documents contract.

Migration 20261004120000_audit_review_indexes adds tenant/date, tenant/actor/date
and tenant/entity/record/date indexes without rewriting rows or changing RLS.
Only the disposable local database received it. Pending local deployment order:
20261003090000_inventory_module, 20261003100000_services_module,
20261004090000_appointments_module, 20261004100000_workforce_modules,
20261004110000_crm_record_scopes, 20261004120000_audit_review_indexes.
Verify hosted migration history before applying; earlier existing migrations may
also be pending. Do not deploy the record-scope queries before their columns exist.

Validation: 19 audit/core API, migration and formatting checks plus 33 appointment,
workforce, role and CRM-scope regressions passed. Five intercepted browser tests
passed, with the two audit cases rerun after fixing screenshot animation timing.
Desktop/mobile audit screenshots inspected. A 10,000-event service list uses six
SQL statements for five summaries and does not select snapshot columns; EXPLAIN
confirms the record-history index. Production build/TypeScript, targeted ESLint
and whitespace checks passed. The local database was stopped after verification.
Run npm.cmd run test:audit:integration against the guarded disposable database.
No commit, push, deployment or hosted data changes were made.

Next: deployment-readiness review of the accumulated local changes and pending
migrations, followed by hosted verification only when deployment is requested.


## Phase 3 deployment-readiness review (2026-10-04, local only)

The accumulated Phase 2 interface and Phase 3 module/access/audit work has passed
local release checks. No commit, push, deployment or hosted database change was
made during this review. Hosted verification remains outstanding.

A fresh disposable PostgreSQL 16 instance applied all 90 committed migrations,
then the six pending migrations over populated tenant, module, role, team and
audit fixtures. All 96 migrations succeeded; a second deploy was a no-op. The five
operational modules retained explicit disabled/revoked choices and granted legacy
access only for missing flags. Existing roles kept ACCOUNT_ROLE, existing team
members did not become managers, invalid scopes were rejected, audit data and RLS
flags remained unchanged, and all three audit indexes were present.

Validation: production build including Prisma generation and TypeScript passed;
112 intercepted local browser tests passed. Desktop project and mobile service
screenshots were inspected. The broad unit/integration run plus corrected targeted
reruns covered 293 passing checks; four historical data-upgrade cases remain
skipped because their optional pre-upgrade fixtures were not supplied. This does
not count those four as verified. Nine read-only deployment checks also passed
against the migrated local database as the non-bypass runtime role. Root ESLint
has zero errors and four existing warnings outside this increment; changed tests
lint cleanly. No hosted UI or live authentication flow was exercised.

The broader run exposed old test harness assumptions, now corrected: CRM owns and
closes pools after Prisma clients disconnect; tenant cleanup preserves unrelated
fixtures and simulates legacy records before automatic project choices; pool
fixtures remove their generated choices; provisioning uses its own platform slug
and asserts all nine module flags with unselected modules denied. Sixteen targeted
fixture checks passed after these corrections. Local logs are under ignored tmp/.

Release tooling now has npm.cmd run db:status and npm.cmd run db:deploy. The
read-only test:crm:migration command verifies the six new migration checksums,
CRM record-scope columns/defaults/constraint and valid audit indexes. Generated
browser profiles, reports, test output and scratch files are excluded from lint;
scratch files are excluded from Git. Plaintext login notes were removed from
CONVENTIONS.md and retained only in ignored local storage. They already exist in
Git history: any still-valid credentials must be rotated separately; this review
did not change accounts or rewrite history.

When deployment is requested:

1. Commit the complete accumulated source, tests and all six migration directories.
   Do not stage local environments, authentication state, scratch files or logs.
2. Verify the intended hosted database and Vercel project ID/environment, and take
   the normal database backup. Git origin and package identity are ls-erp; the local
   Vercel link still has the old ls-salon display name, so verify/relink by project ID
   before a CLI deployment. The local project folder name need not change.
3. Run db:status with the intended direct migration connection. Earlier migrations
   may also be pending on the target. Apply db:deploy before deploying this app:
   the new access queries require the CRM scope columns. Never use db:reset or
   db:migrate (development migration command) on the hosted database.
4. Run test:crm:migration with explicit CRM_VERIFY_CONFIGURED_DATABASE=1 and the
   intended runtime DATABASE_URL, then deploy and check build/runtime logs.
5. Follow BROWSER_TESTING.md for hosted admin/staff checks: module denial and
   reactivation, role changes and managed-team boundaries, CRUD permissions,
   audit detail redaction, and the existing enquiry-to-quotation workflow.

The six new migrations are additive. If the new app must be rolled back, retain
the additive schema and restore the previous app deployment; do not drop access
columns or audit indexes as an automatic rollback. New role/module configuration
should be reviewed if restoring older code that cannot enforce those settings.

Next: consolidate the local changes into a reviewed commit, then push/deploy only
when requested, apply the verified migration sequence and perform hosted checks.


## Phase 3 commit checkpoint (2026-10-04)

User authorized consolidation of the reviewed local changes into one commit.
The commit includes shared ERP views, operational module/access boundaries, CRM
record scopes, audit review, all six migrations and their tests/documentation.
The previous local validation results remain applicable; this checkpoint changes
only documentation, whitespace and Git state. Push, deployment and hosted migrations remain
pending. Next: push/deploy when requested, using the release procedure above.

## Phase 4 - real local access verification (2026-10-04)

Audit review was implemented with the Phase 3 access work. This increment verifies
it through the production Next application, real credentials sign-ins and a fully
migrated disposable PostgreSQL database. It does not use intercepted API responses
or mocked authorization. The app runs as the non-superuser, non-bypass RLS role.

All 10 tests in tests/local-access passed. Coverage includes tenant separation,
manager OWN/MANAGED_TEAMS/ALL scopes, explicit team-manager designation and
revocation, staff scope ceilings and read-only actions, concurrent role edits,
module disable/reactivate with data retention, platform allowances versus tenant
activation, CRM module dependencies, audit actor/owner distinction, redacted
snapshots and revocation of an already-open audit entry.

The checks exposed a suspended-account sign-in loop: API access was correctly
blocked, but the old JWT redirected the browser back into protected pages.
The protected layout now checks current user status in tenant context and sends
inactive sessions to sign-in recovery. Sign-in clears expired or wrong-tenant
sessions before allowing another login. Regression coverage verifies suspension,
rejected suspended credentials, successful login with an active account, and
wrong-tenant recovery. Current account role also supplies the module provider.

Production build/TypeScript, targeted ESLint and whitespace checks passed.
Desktop manager/staff and mobile audit screenshots were inspected. Run
npm.cmd run test:access:e2e using the local-only setup in BROWSER_TESTING.md.
No new migration is required. Test tenants and audit records remain only in the
disposable database; the test server and database are stopped after verification.

This completes the local access-verification increment, not hosted rollout or
end-to-end verification of every sales/ERP business workflow. Earlier optional
historical migration fixture skips and unrelated lint warnings remain as recorded
above. Changes are local only: no push, deployment or hosted database writes.
## Phase 4 - sales and ERP workflow verification (2026-10-04)

Added nine real local workflow scenarios to the existing ten access scenarios.
`npm.cmd run test:workflows:e2e` runs all 19 against the production Next build,
real credentials sessions and isolated PostgreSQL using the RLS runtime role.
`npm.cmd run test:access:e2e` retains only the ten access scenarios. No hosted
credentials, API interceptions or mail delivery are used.

Verified sales: subproject Sales > New lead preselection; qualified enquiry
conversion retaining project/subproject and preventing duplicate opportunities;
custom Site visit completion, customer history and a single follow-up; exact
20/80 instalments; quotation revision saved through its edit panel; original
snapshot retention; generated quotation PDF; won/100% close; historical payment
plans when the optional module is disabled; and structured spam loss filtering
and CSV export. New setup and most workflow mutations use authenticated APIs;
this is not a claim that every creation form was exercised through the UI.

Verified ERP: service eligibility and assigned shifts produce bookable hours;
purchase receiving updates stock once; draft booking does not deduct stock;
confirmation retains product/coupon data and deducts stock; repeated cancellation
restores stock once; invoice PDF loads; insufficient stock rolls back the booking
change; explicit empty arrays clear products/coupons; staff leave submission,
direct-manager approval, self-review denial, blocked booking availability and
audit actor attribution.

The tests exposed and fixed a booking partial-update bug. Zod creation defaults
were applied to omitted coupons/productLines in the PATCH schema. A status-only
change could remove products/coupons, change the total and skip stock deduction.
The update schema now removes those two creation defaults, preserving omitted
fields while accepting explicit empty arrays. It adds no queries or migration.

Validation: all 19 combined real local browser/API scenarios and 20 existing
booking/inventory integration checks passed. Production build, TypeScript,
targeted ESLint and whitespace checks passed. Payment-plan and approved-leave
screenshots were inspected; PDF parsing confirms generated documents are valid,
not that every PDF page layout was visually reviewed. Test services were stopped;
synthetic test records remain only in the disposable database.

Remaining UI finding: Leaves request/approval dates still use browser locale
formatting rather than the tenant date preference. Address that consistently in
a focused date/time display cleanup, with a nonlocal-browser-timezone check.
Hosted deployment/migrations and hosted workflow verification remain pending.
Earlier historical migration-fixture skips and unrelated lint warnings remain
as previously documented. Nothing was pushed or deployed.
## Phase 4 - tenant dates and leave conflict rescheduling (2026-10-04)

Resolved the Leaves date/time finding above. Requests, approvals, definition/group
updated times, request details, history, confirmations and conflict previews now
use the shared tenant formatter. Date-only leave values retain their calendar day
when the browser timezone differs. Actual timestamps use the configured locale,
date format, timezone and 12/24-hour clock. The shared hook keeps its legacy
formatDate API and caches one display-settings request rather than querying per row.
CRM history and Leaves share neutral lib/date-display and lib/business-time helpers.
The CRM work-time module re-exports the existing conversions unchanged.

The conflict reschedule endpoint previously interpreted an entered time as UTC,
while the preview used browser time. Both now interpret it in the tenant timezone,
reject invalid/nonexistent/ambiguous local times, and retain appointment durations
and spacing using epoch arithmetic. Audit metadata records the interpreted zone.
The Shifts reschedule time label also identifies that timezone. This adds one
indexed AppSetting lookup per reschedule request, with no schema migration.

Verification: production build/TypeScript and targeted ESLint passed; six date/CRM
history unit tests and 17 existing appointment/workforce integration tests passed.
All 20 local access/sales/ERP scenarios have passed across the full run and the
focused ERP rerun (all five ERP scenarios passed on the final build). The new
scenario uses a Los Angeles browser with an Asia/Kolkata tenant: date-only leave
stays 08/10/2030, preview shows 10:00, stored appointment is 04:30 UTC, duration
remains one hour, invalid date input leaves the appointment unchanged, and manager
approval removes the request from the Pending queue. The test waits for review
completion before independently reading persisted records through the API.
Request-list, history-panel and conflict-preview screenshots were inspected.

No push, deployment, hosted writes or new migration. Local test server/database
were stopped after verification. Next is the local release-readiness review;
hosted rollout and hosted smoke checks remain pending. Prior documented historical
migration-fixture skips and unrelated lint warnings remain unchanged.

## Phase 4 - local release checkpoint (2026-10-04)

Reviewed the accumulated Phase 4 changes for a local commit under the standing
commit-without-push instruction. RELEASE_READINESS.md consolidates current scope,
evidence, limitations, six-migration order, rollout and recovery steps. The final
application build and earlier focused verification remain applicable; this
checkpoint adds documentation only. Nine read-only deployment checks passed again
on local PostgreSQL with the non-bypass runtime role; all 96 migrations are present.
Root ESLint again reports zero errors and four previously documented warnings.
Package/lockfile dependency declarations match; local environment, authentication,
host-link and generated report files are ignored and not tracked. Whitespace checks
passed. No new migration, hosted access, push or deployment. Test database stopped.

Implementation and local verification for this release are complete within the
recorded scope. The next operational step is hosted migration/deployment and smoke
verification when requested, following RELEASE_READINESS.md. Do not push main
before the target database is ready, because the Git connection can auto-deploy.