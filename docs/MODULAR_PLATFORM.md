# Modular business platform — CRM milestones 1–3

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

Calendar/forecast dashboards, opportunity-specific tasks/reminders, bulk changes,
automated stage actions, custom fields and a forecasting ledger remain later work.
Existing enquiry follow-ups remain available through the source enquiry.
Visual browser/drag interaction QA is explicitly deferred by the user.
