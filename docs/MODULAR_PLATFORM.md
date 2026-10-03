## 2026-09-29: Project detail interface (release)

Projects and subprojects now share a read-only overview, record-local tabs and
focused section edit panels. Optional creation fields are collapsed and currency
defaults to business settings. Shared empty pagination is hidden. No schema or
API changes; no hosted data writes. Push/deployment via main is authorized. See [UI delivery notes](CRM_PROJECT_DETAIL_UI.md).

## 2026-09-29: Modular navigation and optional Sales Documents (release)

Sidebar-only CRM, Contacts, Activities, Sales Documents and Real Estate groups
are implemented. Sales Documents and its Payment Plans capability have separate
tenant switches, dependency checks and server enforcement. Quotation code is
extracted from CRM; existing URLs and saved versions are retained. See
[delivery notes](CRM_MODULE_NAVIGATION_DELIVERY.md). The additive flag-backfill
migration is applied (87 migrations up to date); application release is authorized
via main. Hosted workflow verification remains pending.

## 2026-09-29: Quotation / payment-plan documents (release)

Reusable quotation templates, exact charges/instalments, immutable versions and
PDF download are implemented. See [delivery notes](CRM_QUOTATIONS_PAYMENT_PLANS.md).
The [four-phase checkpoint](CRM_CHECKPOINT_2026_09_29.md) is already pushed, migrated
and deployed. The quotation migration is also applied; all 86 hosted migrations are up to date.
Application release is authorized via main.
Full hosted workflow verification remains deferred by user instruction.

## 2026-09-29: CRM checkpoint release

The three Odoo-alignment migrations (project choices, custom fields and sales
teams) have applied successfully to the hosted database. Application deployment
`df1b560` is Ready on Vercel, including CRM Test. Per user instruction, full hosted
workflow verification is deferred
until after quotation/payment-plan implementation. Prior local checks remain
recorded in the phase documents; they are not hosted acceptance results.

## 2026-09-29: Odoo alignment Phase 4 (local, not deployed)

Sales teams, member assignment, qualification/direct-opportunity workflows,
team-scoped custom fields and reviewed configuration presets are implemented.
Existing staff visibility and unassigned-record workflows are preserved. Team
filters reconcile sales reports and exports. See [Phase 4 delivery and checks](CRM_ODOO_PHASE_4.md).
No hosted data or migrations changed. Payment-plan documents are the next agreed
feature; collections and accounting remain deferred.

## 2026-09-29: Odoo alignment Phase 3 (local, not deployed)

Shared typed custom fields now cover enquiries, opportunities and Real Estate
projects. Manager configuration, prospective required rules, permissions,
conversion snapshots, indexed filters and batch CSV exports reuse one engine.
See [Phase 3 delivery and verification](CRM_ODOO_PHASE_3.md). Phase 4 sales teams
and workflow presets remain planned. No hosted records or migrations changed.

## CRM Odoo alignment Phase 2 - 2026-09-29

Implemented locally: configurable project statuses, shared property categories
and buying timeframes under CRM Configuration > Real Estate. Includes tenant
catalogs, defaults, ordering, archive/restore, searchable selectors and preserved
labels. The additive migration was verified against existing local fixture data;
CRM regressions and desktop/mobile browser checks passed. See
[CRM_ODOO_PHASE_2.md](CRM_ODOO_PHASE_2.md) for verification and release/recovery.
No hosted migration or deployment was performed. Custom fields are the next phase.

## CRM Odoo alignment Phase 1 - 2026-09-29

Implemented locally: injected CRM extension contracts, application composition,
Real Estate server/view adapters and CRM Configuration navigation. Core CRM no
longer imports Real Estate implementations. Existing APIs and data remain compatible;
no migration is required. See [CRM_ODOO_PHASE_1.md](CRM_ODOO_PHASE_1.md) for checks
and local-versus-hosted status. Configurable project choices are the next phase.

## Odoo benchmark and early refactor decision - 2026-09-29

The active forward plan is [CRM_ODOO_ALIGNMENT_PLAN.md](CRM_ODOO_ALIGNMENT_PLAN.md).
It preserves shared CRM and optional Real Estate, prioritizes industry integration
boundaries, configurable project choices and reusable additional fields, then
sales-team workflow configuration. These refactors are planned, not implemented.
Existing CRM Test leads remain the regression baseline; no pilot or import is requested.
Older deployment notes below are historical; the latest recorded release baseline
is commit `3e2971c`, including configurable activity types.

## Configurable CRM activity types - 2026-09-28

Tenant-specific activity types, inherited behaviours, defaults, filters and history
are implemented. See [CRM_ACTIVITY_TYPES.md](CRM_ACTIVITY_TYPES.md) for setup and verification.

## Configurable lost reasons - 2026-09-28

Shared enquiry/opportunity reasons, conditional closing controls, scoped filters,
reporting and historical-label preservation are implemented. See
[CRM_LOST_REASONS.md](CRM_LOST_REASONS.md) for configuration and verification.

## CRM Phase 6 internal regression - 2026-09-28

Phase 6 now uses the existing CRM Test leads, as requested by the user.
Read-only admin/staff checks and an upgrade baseline are in
[CRM_SALES_PHASE_6.md](CRM_SALES_PHASE_6.md). The hosted business still lacks
Phase 2-5 endpoints; deployment and new sales workflow checks remain pending.
No client pilot or legacy import is part of this step.

## CRM sales extension milestone - 2026-09-28

Phases 2-5 are implemented and verified locally, pending deployment.
See [Phase 2](CRM_SALES_PHASE_2.md) for lead intake and
[Phase 3](CRM_SALES_PHASE_3.md) for optional Real Estate projects, module
dependencies, staff access, migration and verification.
[Phase 4](CRM_SALES_PHASE_4.md) adds optional project-linked enquiries/opportunities,
buyer requirements, preserved conversion context, project sales views and an
explicit editable pipeline draft. [Phase 5](CRM_SALES_PHASE_5.md) adds scoped sales
reporting, reconciling drill-downs and bounded CSV exports. The active delivery
sequence is [CRM_EXTENSIBILITY_PLAN.md](CRM_EXTENSIBILITY_PLAN.md).

# Modular business platform — CRM milestones 1–7

## Contact workspace UI — 2026-09-28

The contact detail view uses separate cards for contact information, business
accounts, activities and shared interaction history. Fixed choices use the shared
shadcn/Radix `DropdownSelect`; large record choices retain server-side searchable
comboboxes. Contact activities expose search and status, group secondary filters
in a labelled popover, and place Apply plan / Log interaction in More actions.
Mobile activities use cards; empty sections omit redundant tables and pagination.

`CrmSection` provides the section pattern for further CRM work. The compact work
list, interaction card and pagination treatments are opt-in on this view; other
CRM screens retain their current layout. Contact saves, archive/unlink confirmation,
server pagination, record context, permissions and version checks are preserved.
No API or database changes are required. Seven browser checks exercise the real
components with intercepted test data and writes, including filters, pagination,
archive/restore, account relationships, staff read-only access and mobile themes.

Customer interactions and activity history/internal notes now share a connected
timeline with event icons, author initials, timestamps and separate message cards.
Both timelines use centered, independently paginated controls. Internal notes
retain their permission checks and history retains business-time-zone formatting.
Local browser verification covers light/dark themes, mobile layout, centered
pagination, note submission and read-only access; history-format regressions pass.

## Architecture decision

Keep one Next.js application and PostgreSQL database. The business tenant is the
isolation boundary. Organization remains the parent/provisioning grouping; it does
not grant implicit access to tenant CRM records. A property development is a
business record, not a tenant. Property renters are unrelated to SaaS tenants.

`platform/` owns business request context, module metadata and shared errors.
`modules/crm/` owns contacts, business accounts, their relationships, enquiries,
tasks, activity, validation and operations.
`app/` contains thin API entry points and pages. Existing UI primitives are reused.
CRM operations recheck the current active user and enabled module, enforce record
scope and run changes and required audit entries in one transaction. Serializable
transaction conflicts are retried up to twice; record edits also carry a version.
Other modules and future integration adapters must call these operations.

The first independently switchable module is CRM. Legacy salon, inventory,
purchasing and workforce routes are deliberately not advertised as switchable:
their server boundaries must first be extracted and tested. Existing salon
navigation, authentication, pricing and booking paths are preserved.

## Implemented

- Per-business CRM enable/disable at `/settings/modules`, restricted to current
  active business administrators. Disable preserves all records.
- Independent contacts, with name and optional email/international phone. A
  contact can have many enquiries and needs no password or login account.
- Exact email/phone duplicates rejected within a tenant, including concurrent
  creates. Emails are normalized to lowercase; phone formatting is normalized to
  international `+` form. Names alone are not treated as proof of duplication.
  Duplicate responses do not reveal inaccessible contact details.
- Contact editing and archiving, enquiry creation, assignment, requirements,
  source, status and required closure outcome.
- Enquiry notes, activity history, date-only follow-ups, completion and overdue
  filters. Follow-ups belong to the enquiry and follow its current assignment.
- Server pagination and search for contacts, enquiries, tasks, activity and
  salesperson/contact selectors.
- Administrators/managers see the tenant's CRM records. Staff see contacts they
  own or contacts linked to their assigned enquiries; they may edit only their
  own contacts. Staff can work only on enquiries assigned to themselves and cannot
  assign another salesperson. Customer accounts and platform-console users have
  no CRM access. Teams/custom permission bundles are a later milestone.
- Non-null tenant IDs, composite tenant foreign keys, RLS on all new tables,
  transactional audit records and optimistic edit conflict detection.

This is enquiry tracking. NEW / CONTACTED / QUALIFIED / CLOSED are initial fixed
enquiry statuses, not the future configurable opportunity pipeline. Follow-ups
are manually tracked; no automatic reminders, scheduler or retry worker is enabled.

## Additive migration and rollout

`prisma/migrations/20260923090000_crm_foundation/migration.sql` adds five tables,
one enum and a composite User uniqueness constraint. It drops no existing table
or column and rewrites no existing customer/account data. CRM defaults to disabled.
The migration uses the existing `app.tenant_match` RLS function.

1. Review and apply the migration through the existing controlled database
   deployment process. Do not use a reset or `db push` on an existing database.
2. Generate the Prisma client and deploy the application together with the schema.
3. A business administrator enables CRM under Settings → Modules.
4. Create a contact, create an enquiry, assign a salesperson and add a follow-up.
5. Verify staff and tenant boundaries in the target staging environment before
   enabling CRM for additional tenants.

On 2026-09-23, following the user's explicit request to apply migrations, this
migration was deployed to the configured Supabase database with `prisma migrate
deploy`. It was the only pending migration. Post-deployment migration status was
up to date and a read-only schema diff reported no differences. Existing record
counts were unchanged; no CRM demo/test records were added to that database.
CRM remains disabled by default until a business administrator enables it.

Before deployment, the incremental migration was tested on an isolated,
disposable local PostgreSQL instance initialized with the pre-change schema and
existing RLS. All write-based workflow tests use the disposable database.

`CrmContact.legacyUserId` is an optional tenant-safe bridge for a later, reviewed
salon customer import. No automatic backfill or merge occurs. Existing appointment
customer IDs still refer to User. New restrictive CRM foreign keys intentionally
prevent legacy seed/reset/user-delete operations from silently deleting referenced
CRM data; reset/import tools need a separate CRM-aware design before broader use.

## Identity and industry extension roadmap

1. Business accounts and contact/account relationships are implemented in milestone
   2 below. Purchasing can later link supplier profiles to them. Authentication
   `Account` and platform `Organization` remain separate from CRM companies.
2. Opportunities and configurable pipelines are implemented in milestone 3 below.
   Next, deliberate contact merging needs relation reassignment, permissions and history. Shared phone/email
   exceptions require an explicit duplicate policy before relaxing uniqueness.
3. Migrate login identity separately: introduce tenant memberships, backfill from
   existing User tenant/role assignments, verify membership-based access, then
   migrate sessions and staff references. Keep current login available during the
   transition. Never link identities purely from unverified matching contact data.
4. Move service booking, inventory/purchasing and workforce operations behind
   module boundaries incrementally, with regression tests for each extraction.
5. Real estate owns developments, units, listings, viewings, reservations and
   bookings. It consumes CRM contacts/opportunities; it must not overload
   AppointmentOrder or CRM status fields to represent property bookings.
6. Introduce separate billing/payment models with explicit document currency,
   exact monetary precision, receipt allocations and reversals. Existing integer
   cents and appointment totals are not a general accounting ledger.

## Lia boundary

Lia was inspected read-only. Its `docs/APPOINTMENT_ADAPTER_CONTRACT.md` describes
provider operations, scoped identity, confirmation and final availability/
idempotency checks. It is an integration reference, not an existing CRM contract.

The later CRM adapter must map one authorized Lia project to one business tenant
(multiple projects may target a business), authenticate a service actor, enforce
operation capabilities and store idempotency keys and Lia record references.
CRM remains authoritative for business data; Lia owns conversations and flows.
There is no Lia credential, project mapping, webhook or external-write endpoint in
this milestone. No Lia files were changed. Unified login remains a separate plan.

## Verification

No new dependencies are required. `npm run test:crm` uses Node's test runner and
the existing TypeScript compiler for validation/policy and salon pricing checks.

For database tests, use an empty local PostgreSQL database named
`ls_salon_crm_test`, set `CRM_TEST_DATABASE_URL`, then run:

```text
node scripts/prepare-crm-test-db.cjs
npm run test:crm:integration
```

The setup refuses non-local, differently named or non-empty databases. It creates
the current schema, existing/new RLS policies and a non-superuser, non-BYPASSRLS
application role. An optional `CRM_TEST_BASE_SQL` file containing the pre-change
schema tests the full incremental CRM migration instead of generating the current
schema. To test an upgrade from a schema that already includes the first CRM
migration, also set `CRM_TEST_FROM_MIGRATION=20260923120000_crm_business_accounts`.
This setup expects a disposable database with a local trusted test role;
it is not production provisioning guidance.

Database tests cover the complete workflow; raw RLS reads/writes; cross-tenant
foreign keys; staff scopes on details, search and activity; assignments; duplicate
normalization and races; archive behavior; stale edits; concurrent task completion;
audit rollback; disabled/suspended/customer access; and legacy salon relationships.
These checks do not certify every pre-existing salon workflow or the live database.

### HTTP smoke test

After database preparation, run `node scripts/seed-crm-test-demo.cjs` once using
the same local `CRM_TEST_DATABASE_URL`. It creates synthetic `crm-demo` accounts;
it refuses to overwrite an existing fixture. Point a separate application process
at that database's `crm_test_runtime` role, set `APP_ROOT_DOMAIN=localhost`,
`AUTH_TRUST_HOST=true`, `AUTH_URL=http://crm-demo.localhost:3107` and a test-only
`AUTH_SECRET`. Start the built app on `127.0.0.1:3107`, then set
`CRM_TEST_HTTP_ORIGIN=http://127.0.0.1:3107` and run:

```text
node --test tests/crm.http.test.cjs
```

The synthetic credentials in the fixture are public test data, not real accounts.
The test verifies actual sign-in, unauthorized access, module enablement, malformed
JSON, CRM writes, staff access, activity and server rendering for CRM and existing
appointment pages. It does not provide visual or browser interaction coverage.

Verified for milestone 1: Prisma schema/client generation; the additive
migration on a pre-CRM schema; 5 unit/regression tests; 10 PostgreSQL integration
tests; 1 real HTTP workflow test; TypeScript; targeted ESLint; and a production
build. Build required network access for the application's existing Google Fonts.
Visual browser QA is explicitly deferred at the user's request.

### Read-only deployment verification

Set `CRM_VERIFY_CONFIGURED_DATABASE=1` and run `npm run test:crm:migration` to
verify the database configured by `DATABASE_URL`. These checks run inside a
read-only transaction and add no fixtures. They verify all three deployed migration
checksums/history, all eleven forced RLS policies, nineteen validated composite foreign
keys and the runtime database role's lack of superuser/RLS-bypass privileges.
All four deployment tests passed on the configured Supabase database after rollout.
Unit tests and TypeScript checks also passed again during deployment.

## Milestone 2 — business accounts and contact relationships

- `/crm/accounts` supports paginated search, create, edit, archive and restore.
  Accounts store company name, email, international phone, website and notes.
- `CrmAccount` is independent of login accounts, platform organizations and
  suppliers. Identical company names or shared email/phone values are allowed;
  they are not automatically treated as the same legal/business entity.
- Contacts can link to multiple accounts, and accounts can have multiple contacts.
  Manage these relationships on the contact page; inspect permitted contacts on
  the account page. Removal requires confirmation, retains both records, and is
  recorded in audit history. Repeated link/unlink requests do not duplicate audits.
- Administrators/managers can access tenant accounts. Staff can see accounts they
  own or accounts linked to contacts they can already access; only account owners
  and managers can edit account fields. Account visibility or ownership never
  grants access to an otherwise private contact.
- Linking requires an editable contact and an already-visible account. A guessed
  account ID cannot grant access. Archived accounts/contacts reject new links;
  existing relationships remain visible and can be removed by the contact owner
  or a manager. List totals and pagination respect contact-level permissions.
- Account edits use version checks. Account and relationship changes require
  transactional audit entries. The two new tables force tenant RLS; composite
  foreign keys prevent cross-tenant owners and relationships.

The additive migration is `20260923120000_crm_business_accounts`. It creates two
tables with indexes, foreign keys and policies, without altering existing data.
The full upgrade from the previous CRM schema passed in disposable PostgreSQL,
along with 6 unit/regression and 16 database integration tests. The real HTTP
workflow test passed against the production build, covering account creation,
linking, inherited visibility, unauthorized unlinking, and account page responses.
Prisma validation/client generation, TypeScript and targeted ESLint also passed.
Visual browser testing remains deferred.

On 2026-09-23, `prisma migrate deploy` applied the business-account migration to
the configured Supabase database. All four read-only deployment checks passed
against both CRM migrations, seven RLS-protected tables and ten composite foreign
keys. Migration status is up to date and schema diff reports no differences.
No test fixtures were inserted into Supabase; CRM enablement remains a per-business
administrator action. Application hosting deployment is separate from this schema
rollout and has not been performed.

## Milestone 3 — opportunities and configurable sales pipelines

The design follows the common CRM pattern of configurable sales processes,
stage probabilities, owned opportunities, expected close dates and explicit
won/lost outcomes. Reference documentation reviewed:
[Salesforce stage configuration](https://help.salesforce.com/s/articleView?id=000384827&language=en_US&type=1),
[Odoo pipeline analysis](https://www.odoo.com/documentation/18.0/applications/sales/crm/performance/win_loss.html),
and [SugarCRM sales console](https://support.sugarcrm.com/documentation/sugar_versions/25.1/sell/application_guide/user_interface/dashboards_dashlets/sales_console/).
This implements those shared concepts, not all features of those products.

- `/crm/pipelines`: managers/admins create multiple business-specific pipelines.
  A new-pipeline form offers editable sample stages; the actual stages and board
  columns come from tenant data. Managers rename/reorder stages, change colours
  and default probabilities, and archive/restore stages or whole pipelines.
- Each pipeline retains at least one active OPEN, WON and LOST stage. WON is
  100%, LOST is 0%, and OPEN is 0–99%. A stage in use cannot change outcome type.
  Existing stages are archived rather than deleted; deals remain readable and
  can move out to an active stage/pipeline. No automatic data backfill occurs.
- `/crm/opportunities`: Kanban and paginated table views share pipeline, search,
  salesperson, outcome and sort filters. Each board column pages independently
  and displays the full matching count. Drag/drop and the accessible stage
  selector call the same version-checked move operation. Lost moves require a
  reason; errors refresh the board instead of pretending the move succeeded.
- Opportunities require a contact, owner, pipeline/stage, expected close date,
  amount and currency, with an optional business account and description.
  Amounts use `Decimal(18,4)` and JSON decimal strings; they are not integer salon
  cents. Currency is explicit per deal; display respects business number formatting
  and preserves all stored decimal places. There is no exchange-rate conversion,
  cross-currency aggregation or accounting entry in this milestone.
- Stage probability is copied to the opportunity on creation/move and can be
  overridden for open deals. Changing a stage default does not rewrite existing
  opportunities. Closing records a timestamp; reopening clears it and the
  current loss reason while retaining the previous outcome in history/audit.
- An open enquiry can be converted once. Concurrent/repeated conversions reuse
  the same opportunity. Its contact is preserved, and source enquiry history and
  follow-ups remain intact; conversion does not silently close the enquiry.
  Opportunity history includes notes and stage transitions with loss reasons.
- Staff work on assigned opportunities. Assignment makes that deal's contact and
  optional account visible but does not permit editing their master data or
  expose other contacts at the account. Reassignment revokes derived access when
  no other ownership, enquiry or opportunity grants it. Managers retain tenant-wide
  access. All changes and required audit/history entries share a transaction.
- New models live in CRM. `sales-service.ts` reuses the module's authorization,
  serializable transactions and audit boundary; HTTP routes remain thin adapters.
  Future industry modules should reference opportunities, not repurpose their
  sales stages as bookings, inventory movements or accounting records.

`20260923160000_crm_sales_pipelines` is additive: four new tables and one enum,
tenant RLS, composite foreign keys (including pipeline/stage consistency), and
amount/probability check constraints. The upgrade from milestone 2 was exercised
against disposable PostgreSQL with a non-bypass runtime role. Nine unit tests
and 25 integration tests pass, including race conditions, stale writes, conversion,
permissions, archive behavior, precise money and required-audit rollback.
The production build, TypeScript, targeted ESLint and real authenticated HTTP
workflow also passed. HTTP checks cover pipeline permissions, conversion,
loss-reason validation, optimistic conflicts, filtered lists, notes, disabled CRM,
new page responses and existing appointment page rendering.

On 2026-09-23, the sales-pipeline migration was applied to the configured Supabase
database using `prisma migrate deploy`. All four read-only deployment checks
passed across three CRM migrations, eleven forced-RLS tables and nineteen
validated composite foreign keys. Migration status is up to date and the schema
diff reports no differences. No fixtures or pipelines were added to Supabase.
An administrator enables CRM, then a manager creates a pipeline to start using
opportunities. Application hosting deployment has not been performed.

Forecast dashboards, bulk changes, automated stage actions, custom fields and a
forecasting ledger remain later work. Activities and calendar are covered below.
Visual browser/drag interaction QA is explicitly deferred by the user.

## Milestone 4: staff activities, customer interactions and calendar

The workflow draws on [SugarCRM call management](https://support.sugarai.com/documentation/sugar_versions/25.1/sell/application_guide/calls/),
[Salesforce call logging](https://help.salesforce.com/s/articleView?id=sf.copilot_actions_ref_log_a_call.htm&language=en_US&type=5)
and [Odoo's complete-and-schedule-next pattern](https://www.odoo.com/documentation/14.0/applications/productivity/discuss/overview/plan_activities.html).
It implements an operational staff workspace; it does not claim feature parity
with those products.

- **My Work** (`/crm/activities`) contains tasks, calls, meetings and manually
  logged emails. Filter by personal/accessible work, staff, type, status,
  due date or due reminders. Lists and histories are paginated. Activities have
  their own assignee, priority and instructions, independent of deal ownership.
  Contact, enquiry and opportunity pages embed the relevant activities.
- Schedule all-day work or a timed activity, log something that already happened,
  mark work in progress, cancel with a reason, or complete with an outcome and
  summary. Calls capture direction, actual time and optional duration. The next
  callback can be scheduled in the same transaction as completion; stale or
  concurrent requests cannot create duplicate next follow-ups.
- Staff assigned an open activity can read the customer context and previous
  shared summaries without acquiring access to another salesperson's private
  opportunity fields or notes. Completing/cancelling their last assignment removes
  that derived customer access. They retain their own completed activity record.
  Contact master-data editing still requires contact ownership or management access.
- Completed interaction summaries are shared with staff who currently have access
  to that customer, across the customer's activities. Preparation instructions,
  internal activity notes and deal notes retain their narrower permissions.
  The form labels this distinction. Completed outcomes are retained; corrections
  can be appended as internal notes. Do not place private preparation in a shared
  customer summary.
- Managers can delegate and reassign activities; only the assignee or a manager
  can change one. A deal owner can read delegated work on their deal but cannot
  change another assignee's work unless they are a manager. Reminder snooze/dismiss
  belongs to the assignee. Reassignment and rescheduling reset reminder dismissal.
- **In-app reminders** appear in the CRM banner and My Work. The banner refreshes
  every 60 seconds while visible and when the window regains focus. Snooze for
  15 minutes, one hour or one day, or dismiss without completing the activity.
  There is no background delivery, email, push notification or outbound calling
  in this milestone. Email is an interaction log, not an email-sending feature.
- **Activity calendar** (`/crm/calendar`) reuses installed Syncfusion EJ2 through
  `components/business-calendar.tsx`: day, week, month and agenda, filtered staff
  work, open-activity drag rescheduling and click-to-schedule/detail. The business
  time zone and week-start settings apply; all-day dates remain dates. Timed
  values are stored as instants. Nonexistent or ambiguous daylight-saving local
  times are rejected rather than guessed. Calendar queries are bounded to 62
  days and load at most 500 matching activities, with an explicit truncation
  message directing users to narrow filters or page through My Work.
- Opportunity Kanban cards and list rows show overdue activity counts calculated
  by the server within the user's access scope. Timed work becomes overdue after
  its start; all-day work becomes overdue after its business due date.
- The API lives under `/api/crm/work`, with completion, cancellation, reminder and
  history operations, plus `/api/crm/contacts/:id/interactions`. `work-service.ts`
  reuses the CRM authorization, serializable transaction/retry and required audit
  boundary. Validation, time conversion and UI are separate from persistence.
  The shared calendar component has no CRM or salon persistence dependency.

### Activity upgrade and compatibility

`20260924090000_crm_activity_workspace` extends `CrmTask` so existing follow-ups
remain the same records. It adds an immutable activity-event table, statuses,
assignment, optional opportunity linkage, schedules, summaries and reminders.
The migration runs transactionally and backfills existing contacts, assignees,
completion states and timestamps. Unknown historical authors and summaries stay
unknown. It does not invent calls or import fixtures into the configured database.
Composite foreign keys enforce tenant and parent/customer consistency. A deal
with activities cannot change its contact and move past interactions to another
customer. All new tables force tenant RLS.

Legacy enquiry follow-ups inherit subsequent enquiry assignment until explicitly
edited through the new workspace. New activities keep their explicit staff
assignment when the parent deal/enquiry is reassigned. Database invoker triggers
preserve old application insert/completion/reassignment writes during rollout;
they do not bypass tenant RLS. The legacy task API remains compatible for inherited
follow-ups, and `/crm/tasks` opens My Work.

The upgrade fixture in `tests/fixtures/crm-before-activities.sql` runs only in the
guarded disposable test database. To exercise the upgrade, prepare a schema dump
from the previous milestone, set `CRM_TEST_BASE_SQL` to that dump,
`CRM_TEST_BASE_DATA_SQL` to the fixture, and `CRM_TEST_FROM_MIGRATION` to the activity
migration before running `scripts/prepare-crm-test-db.cjs`. Set
`CRM_TEST_EXPECT_UPGRADE_FIXTURE=1` when running the integration suite.

Next candidates are automatic activity sequences/escalations, background reminder
delivery, recurring meetings/attendees, email/telephony integration, external
calendar sync and activity reporting. Those should extend this activity boundary
with adapters and explicit delivery state, rather than add salon-specific fields
or make opportunity stages perform accounting/inventory operations.

### Verification and rollout

On 2026-09-23, all 53 checks passed: 11 unit tests, 36 disposable-database
integration tests (including a populated legacy upgrade), one authenticated HTTP
workflow, and five read-only checks on the configured Supabase database. The
production build, TypeScript and targeted ESLint also passed. HTTP verification
covers staff call completion, atomic next callbacks, reminders, shared history,
overdue opportunity counts, module access and new page responses. It does not
exercise browser hydration, calendar drag gestures or visual layouts; that QA
remains deferred at the user's request.

The activity migration was applied with `prisma migrate deploy`. All 74 migrations
are current, the Prisma schema diff is empty, and the deployment checks verify
four CRM migration checksums, twelve forced-RLS tables, twenty-seven validated
composite foreign keys and both invoker compatibility triggers. No test fixtures
were added to Supabase. Application hosting deployment has not been performed.

## Milestone 5: activity overview and follow-up coverage

`/crm` now opens `/crm/overview`, with an Overview link in CRM navigation and the
sidebar. This follows the activity reporting pattern documented in
[Salesforce Activity Reports](https://help.salesforce.com/s/articleView?id=analytics.reports_activity.htm&language=en_US&type=5)
and [Odoo's Activities Analysis view](https://github.com/odoo/odoo/blob/19.0/addons/crm/report/crm_activity_report_views.xml).

- Staff see their assigned work. Managers can switch between their own work and
  team reporting, then filter by assignee and activity type. Team reporting is
  checked on the server; owning a deal with delegated activities does not grant
  team-report access. All aggregate and detail queries remain tenant-scoped.
- Current workload includes open, overdue and due-today counts. Completed work
  uses a separate inclusive date period, defaulting to the last 30 business
  calendar dates. The maximum period is 366 dates. Changing the completion period
  does not hide current backlog. Overdue and due-today counts can overlap for timed
  work; they are not additive categories.
- Completions are counted by `completedAt`, the date work was marked complete or
  logged, in the business time zone. They are credited to the activity assignee,
  not the user who clicked Complete. A backdated interaction's `occurredAt` does
  not change when it was recorded in this operational report. Activity-type and
  call-outcome breakdowns use the same selection. Legacy completed tasks count
  without inventing missing outcomes or customer summaries.
- Managers have a paginated staff workload table including zero-work staff and
  inactive assignees with outstanding work. Counts use server aggregates, not
  sums of the first page. Cards and workload counts link to filtered My Work lists;
  completion links preserve the report's business-date period.
- The follow-up gap list shows open opportunities in active pipelines/stages with
  active contacts and **no directly linked open activity**, regardless of activity
  type, date or assignee. A delegated or overdue open activity still provides
  coverage. Completed and cancelled activities do not. Source-enquiry tasks and
  contact-only work do not count as opportunity-specific coverage. The list uses
  the selected deal owner, is paginated by earliest expected close, and offers
  Schedule follow-up. Activity type and completion-period filters do not affect
  this list, as its explanatory text states.
- Read-only APIs are `/api/crm/reports/activities`, `/staff` and `/follow-up-gaps`.
  `report-service.ts` uses the existing CRM membership/module checks and transaction
  boundary. No external messages, automatic reassignment or scheduled jobs run.
- Business-date boundaries handle daylight-saving transitions that skip midnight
  and skipped calendar dates. Calendar date-window queries share the same boundary
  helper; explicit appointment/activity time entry continues to reject ambiguous
  or nonexistent local times.

This milestone uses the existing schema and indexes; no migration is required.
Browser interaction/visual QA and application hosting deployment remain deferred.
Automatic activity plans, escalation rules and background notification delivery
remain separate next milestones.

Verification on 2026-09-23: 59 tests/checks passed (13 unit, 40 disposable-database
integration, one authenticated HTTP workflow and five read-only configured-database
checks). The production build, TypeScript and targeted ESLint passed. HTTP coverage
includes report access restrictions, totals, call outcomes, follow-up gaps,
completion-period drill-through and overview page rendering. All 74 database
migrations remain applied, with no Prisma schema differences. The isolated test
server and disposable database were stopped after verification.

## Milestone 6: reusable activity plans

Activity plans use the launch-date scheduling pattern described in
[Odoo's activity-plan documentation](https://www.odoo.com/documentation/19.0/applications/sales/crm/optimize/utilize_activities.html).
The implementation schedules a reviewed set of activities up front; it is not a
conditional workflow engine or background message sender.

- `/crm/activity-plans` provides searchable, paginated active/archived plans.
  Managers create and edit templates; staff can read and apply them. Templates
  support 1–12 ordered steps with title, type, calendar-day offset (0–365 days),
  priority, instructions, call direction and optional local reminder time.
  Templates are shared configuration visible to CRM staff, so their instructions
  should be reusable guidance rather than private information about a customer.
- Apply a plan from My Work, a contact/enquiry/opportunity's activity list, or the
  plan list. Select the target, start date and responsible staff member, then
  preview all deadlines and reminder times before scheduling. Staff can assign
  only themselves; managers can choose another active member of the business.
  Parent/customer matching and current access are checked again on the server.
  Closed enquiries and won/lost or archived opportunities cannot receive new plans.
- All steps become independent all-day activities at launch, including later-due
  steps. Offsets include weekends and holidays. A reminder, when configured, uses
  the business time zone on that step's due date. Ambiguous/nonexistent DST times
  reject the launch with an explanation. Staff may subsequently schedule a
  specific activity time through the usual activity editor and calendar.
- Generated work uses the existing activity permissions, outcomes, reminders,
  customer history and required audit trail. My Work shows the original plan name
  and step number, supports a launch filter, and activity detail links to the
  accessible activities from the same launch. The filter does not widen access.
- Applying a plan creates its snapshot and all activities atomically. Retries with
  the same request key and payload by the same actor return the same launch.
  Changing a payload with a used key returns a conflict. Separate concurrent
  requests cannot apply the same plan twice to the same target while its prior
  launch still has open/in-progress activities. A plan may be deliberately applied
  again after every prior activity is complete or cancelled.
- Each launch preserves its name, version, input and resolved schedule. Editing
  or archiving a template affects future launches only. Activities remain editable
  through normal staff permissions; completing one does not automatically cancel,
  reschedule or trigger the other steps. Stop unwanted work by cancelling the
  relevant activities, retaining each cancellation reason and history.
- Email steps are manual work items; reminders use the existing in-app delivery.
  There are no outbound messages, telephony actions, automatic stage triggers,
  conditional branches, business-day calendars or per-step assignee overrides.
  Completion-triggered suggestions are added in milestone 7 below. Escalation
  rules and background notifications remain later work.

The additive migration `20260924120000_crm_activity_plans` creates
`CrmActivityPlan` and `CrmPlanLaunch`, plus nullable activity-origin fields.
Existing activities remain unchanged. Both new tables force tenant RLS, composite
foreign keys enforce tenant ownership, and unique keys protect request/step
identity. Template definitions and launch snapshots are bounded JSON validated by
Zod; tasks remain relational records in the existing activity service. HTTP routes
are thin adapters. The bounded multi-step transaction has a 20-second timeout to
allow audited launches over the hosted database connection.

Verification on 2026-09-23: all 66 tests/checks passed (14 unit, 46 database
integration, one authenticated HTTP workflow and five read-only deployment checks).
Coverage includes maximum-size launches, same-key retries, competing requests,
template snapshots, archive/stale-write handling, authorization, tenant RLS,
foreign-key rejection, DST validation and required-audit rollback. The production
build, TypeScript, Prisma validation and targeted ESLint passed.

The plan migration was applied to the configured Supabase database with
`prisma migrate deploy`. All 75 migrations are current and the Prisma schema diff
is empty. Deployment verification covers five CRM migration checksums, fourteen
forced-RLS tables and thirty validated composite foreign keys. No templates or
test fixtures were added to Supabase. The isolated test server and database were
stopped. Application hosting deployment and visual browser testing remain deferred.

## Milestone 7 — reviewed, outcome-based follow-up rules

Managers configure rules at `/crm/follow-up-rules`: completing a particular
activity type with a particular outcome suggests one next activity. For example,
an unanswered call can suggest another call tomorrow with a morning reminder.
This builds on the suggested/triggered next-activity pattern described in
[Odoo's activity documentation](https://www.odoo.com/documentation/19.0/applications/sales/crm/optimize/utilize_activities.html).

- Each business has at most one rule per type/outcome, including archived rules.
  Edit or restore the existing rule to change its trigger. Managers configure;
  CRM staff can read definitions. Configuration is shared guidance and should
  not contain private customer details.
- Rules reuse activity-plan step validation and editor fields: title, activity
  type, priority, instructions, call direction, 0–365 calendar days after
  completion, and optional local reminder time. The next activity keeps the
  current customer, parent record and assignee. Days include weekends and
  holidays. Dates use the business's current local date when completion is
  saved, independently of the recorded interaction's occurrence date.
- The completion form previews the suggestion. Staff choose to create it or
  skip it with a required reason; skipping also permits a manual follow-up.
  A rule and a manual follow-up cannot both run from the same completion.
  Rules create normal all-day work items, including manual email tasks.
  Staff can subsequently edit their times, reminders and other details normally.
- Generated activities record the rule ID, name, version and chain depth.
  Limits of 1–10 consecutive generated activities prevent indefinite retries;
  depth carries across different rules in the same chain. An explicit manual
  activity starts a new chain. Updating or archiving a rule affects future
  completions, including work already open, but does not alter generated work.
- The server rechecks permissions, activity/rule versions, outcome, schedule
  and current related records. Missing or stale reviews return a conflict so
  staff refresh before completing. Closed enquiries, won/lost opportunities,
  archived pipelines/stages/customers and inactive assignees block generation.
  Reaching the chain limit or an ambiguous/nonexistent daylight-saving reminder
  time also blocks generation. Staff may still complete with an audited skip.
  A same-day reminder whose time has passed becomes due immediately.
- Completion, generated work, activity history and required audit entries share
  one transaction. Concurrent requests cannot create duplicate follow-ups.
  Delegated staff retain the customer access needed to continue work without
  gaining access to private parent details. Existing tenant and assignment
  boundaries apply to every generated activity.
- Upfront activity-plan steps do not trigger these rules, avoiding duplicate
  sequences. Logging a past interaction, cancelling work and the legacy quick
  task-completion API also do not trigger them. Legacy completion has no outcome;
  use the activity workspace for reviewed outcome-based follow-ups.

The additive migration `20260924150000_crm_follow_up_rules` adds one forced-RLS
configuration table and four activity-origin fields. Existing activities start
with no rule origin and depth zero. A composite foreign key prevents cross-tenant
origins; database checks enforce complete origin metadata and bounded depth.
No background worker, outbound messaging, stage trigger or escalation engine is
introduced. Background delivery and escalation remain separate future work.

Verification on 2026-09-23: all 75 tests/checks passed (15 unit, 54 database
integration, one authenticated HTTP workflow and five read-only deployment
checks). Coverage includes reviewed completion, concurrent duplicate prevention,
chain limits, manual overrides and skip audits, stale reviews, archived/closed
records, inactive assignees, delegated permissions, tenant RLS, composite foreign
keys, plan/past-log exclusions and complete rollback on required-audit failure.
The incremental migration was exercised over the pre-activity schema and legacy
fixture. Production build, TypeScript, Prisma validation and targeted ESLint passed.

The rule migration was applied to the configured Supabase database using
`prisma migrate deploy`. All 76 migrations are current and the Prisma schema diff
is empty. Read-only verification covers six CRM migration checksums, fifteen
forced-RLS tables and thirty-one validated composite foreign keys. No rules or
test fixtures were added to Supabase. The isolated test server and database were
stopped. Application hosting deployment and visual browser testing remain deferred.

Implementation checkpoints: `a50e1fe` (backend, migration and database tests) and
`1ab763c` (configuration UI, completion review and authenticated HTTP coverage).

## Legacy default tenant retired — 2026-09-27

Businesses are provisioned explicitly. There is no single-business fallback or
default business in the runtime. The platform tenant remains the administrative
control plane and is the only tenant excluded from the business list.

Migration `20260927090000_retire_legacy_default_tenant` removes the historical
`tenant_default` / `default` placeholder only when it has no linked tenant-owned
records. The migration locks the parent row and checks tenant-owned tables with
transaction-local RLS bypass before deleting, preventing accidental cascading
deletion and concurrent creation of foreign-key references. It aborts if data
must first be reviewed or reassigned. Applied historical migrations remain
unchanged; a fresh installation finishes without their obsolete placeholder.
New businesses named `default` have no special handling and appear normally.

Supabase preflight found the legacy tenant empty. The retirement migration was
applied successfully, with all 77 migrations current and no Prisma schema drift.
Three disposable-database tests passed: empty retirement preserves other tenants
and the platform admin, populated retirement rolls back even under a non-bypass
RLS role, and repeat execution preserves an explicitly provisioned business.
All six read-only deployment checks, TypeScript and targeted ESLint passed.
No application hosting deployment was performed.

Run the focused migration tests against the prepared disposable database with
`node --test tests/tenant-cleanup.integration.test.cjs` and the usual guarded
`CRM_TEST_DATABASE_URL` from the CRM testing instructions above.

## CRM interface standardization � 2026-09-28

All CRM lists, editors, reports, calendar controls, plan/rule screens and embedded
sections now share CRM-scoped layout components. Fixed choices use Radix dropdowns,
secondary filters use a common popover, page headers keep save/cancel actions
together, and named sections have consistent cards and spacing. History uses the
shared timeline. Pagination shows record ranges on the left, page controls in the
center and page size on the right, stacking inside narrow sections. These wrappers
do not change the other application modules or the CRM APIs and authorization.

Local verification: 19 unit tests and 11 intercepted browser tests passed. Browser
coverage includes header saves, dependent dropdowns, required-field validation,
activity completion, contact permissions, archive confirmation, account linking,
filter context and pagination. A read-only staging-data preview checked 27 CRM
routes at desktop/mobile widths with no runtime errors or document overflow;
representative light/dark screenshots were inspected. Hosted changes were blocked
in the preview; all mutation tests used intercepted fixtures.

Production build, TypeScript, targeted ESLint and whitespace checks also passed.


## CRM shared record views (2026-09-29)

Extended the project detail/edit-panel pattern across CRM records, activities,
plans, rules, configuration, quotations and templates. See CRM_RECORD_VIEWS.md.
Optional document tabs are selected in application composition; core CRM keeps
its extension boundary. No database migration or permission-policy change.
Local UI verification is separate from hosted acceptance after deployment.


## Default enquiry conversion stage (2026-09-29)

Pipeline configuration now supports one active open default for enquiry
conversion, using the shared edit panel and dropdown. Existing records and
direct opportunity creation retain their behavior. See CRM_CONVERSION_DEFAULT.md
for migration, constraints and local verification. Hosted deployment is pending.


## Platform allowances and tenant module activation (2026-09-30)

Stage 1 adds platform-controlled module allowances above tenant activation for
CRM, Real Estate, Sales Documents and Payment Plans. Shared controls cover
provisioning and existing tenants; server checks, dependencies and required audit
records enforce both layers. Existing activation choices are preserved.
See TENANT_ACCESS_CONTROL.md for migration, verification and remaining role/scope
stages. Changes and both pending migrations are local; not deployed.


## Tenant access Stage 2 (local, 2026-09-30)

Tenant access roles now restrict the existing Staff/Manager account authority across CRM, projects and sales documents. Settings > Access roles provides templates, an action matrix and user assignment; new staff creation supports an initial access role. Typed server requirements cover reads, mutations, exports and generated work, with indexed current-role resolution, forced RLS and transactional audits. Existing users retain legacy access until assigned. The last active tenant administrator is protected. See docs/TENANT_ACCESS_CONTROL.md for configuration, migration and validation details. Not pushed or deployed. Next: indexed own/assigned, managed-team and all-tenant record scopes.


## ERP identity and shared UI foundation (2026-10-03)

Repository renamed to alvinleigia/ls-erp. Neutral presentation components now live in components/erp; CRM adapters preserve authorization and existing workflows. Product branding and tenant-specific invitation/invoice defaults were updated locally. Build, TypeScript, lint, 30 browser regressions and 20 unit checks passed. Legacy module migration remains incremental. See ERP_STANDARDIZATION.md for scope and the pending Vercel Git reconnection, which requires the account GitHub Login Connection. Application changes are not pushed or deployed.

Vercel Git reconnection follow-up (2026-10-03): user reconnected the project; API verification confirms alvinleigia/ls-erp, repository ID 1279282190 and production branch main. The earlier connection blocker is resolved.
