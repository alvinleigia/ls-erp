# Tenant access control

## Stage 1: module allowances and tenant activation

Implemented locally on 2026-09-30. Deployment and hosted migration are pending.

The first rollout covers CRM, Real Estate, Sales Documents and Payment Plans.
Other ERP areas retain their current permissions; they are not yet controlled by
this module catalog.

- Platform: Settings > Tenants > New tenant > Allowed business modules.
- Existing tenant: Settings > Tenants > row actions > Manage modules.
- Tenant administrator: Settings > Business modules.

`TenantModule.allowed` is controlled only by an active platform administrator.
`TenantModule.enabled` is the tenant's activation choice. Both flags and all
module dependencies must permit access. Missing flags deny access. Platform
administrators remain provisioning-only and receive no business record access.
Organization administrators cannot grant modules, including during provisioning.

A new allowance starts enabled if its dependencies are enabled. An allowed child
can remain disabled when the tenant has turned its dependency off. Repeating an
unchanged platform allowance does not overwrite the tenant's activation choice.
Revocation always disables the module. Dependent allowances must be removed
first, even when those dependents are currently disabled.

Deactivation preserves data and configuration. Payment Plans retains its existing
contract: saved quotation versions remain readable/downloadable through Sales
Documents, while creating or editing instalment schedules is blocked. CRM
follow-up generation already runs through the guarded CRM transaction; there is
no independent unguarded scheduler added here.

### Enforcement and queries

The shared catalog drives provisioning choices, module controls, navigation and
layout gates. Services also verify access on the server, including CRM,
properties, document operations, presets and custom-field configuration. UI
visibility is not authorization. Current user status/role is read from the
database instead of trusting an old session role for permission changes.

All module writes use a serializable transaction and lock the tenant row. The
existing `(tenantId, key)` primary key supports the bounded flag lookup. No
per-record permission query or new list scan is introduced. The database check
`TenantModule_enabled_requires_allowance` prevents activation without allowance.

Module changes write required audit records in the same transaction, with actor,
request ID and before/after values. Audit failure rolls back the permission
change. Platform allowance records belong to the target tenant and identify the
platform actor. No API for editing/deleting audit records is introduced.

### Migration

`20260930090000_module_allowances` adds the allowance flag and check constraint.
Existing tenants receive allowances for the four existing catalog modules while
their activation choices stay unchanged. This preserves their pre-migration
ability to activate these modules; it does not enable optional modules. Newly
created tenants default to denied unless the platform selects modules.

Apply migrations before deploying the code that reads `allowed`. The earlier
local conversion-default migration is also pending and must be included. Neither
migration has been applied to the hosted database during this implementation.

### Local verification

- Unit and navigation checks include fail-closed behavior for missing allowances.
- Disposable PostgreSQL tests cover provisioning, forced RLS, current-user checks,
  module dependencies, activation/revocation races, data preservation, database
  constraints and audit rollback.
- Actual provisioning/module API tests run with only authentication mocked.
- Existing CRM, custom-field, project and quotation regression cases pass.
- Three intercepted browser tests cover platform changes, confirmation dialogs,
  tenant activation, mobile layout, creation choices and the tenant row action.
  Desktop/mobile screenshots were inspected. This is not hosted verification.
- Production build, TypeScript and targeted lint pass; the existing tenant-list memo dependency
  warning remains outside these changes.

Commands (only with the guarded disposable local database):

```powershell
npm.cmd run test:crm
npm.cmd run test:modules:integration
npm.cmd run test:tenants:integration
node node_modules/@playwright/test/cli.js test --config playwright.project-ui.config.ts --grep 'platform allowances|tenant controls|tenant creation'
```

## Stage 2: tenant roles and resource actions

Implemented locally on 2026-09-30; push, deployment and hosted migration remain pending.

### Administrator workflow

1. Open **Settings > Access roles > New role**.
2. Start from the Manager, Salesperson or Read-only template, or select permissions
   directly. Templates are immutable starting points; saving creates a tenant role.
3. Set Read/Create/Edit/Archive/Export/Assign for the supported entities. Only
   applicable actions appear; activities use Archive to cancel while preserving history.
4. Use **Assign role** to select an existing Staff or Manager account. The same
   optional Access role selector is available when creating staff or managers in Users.
5. Choosing **Use existing account permissions** removes the custom restriction.

One custom role is assigned per user. Existing users are not automatically assigned
roles. Tenant administrators always retain their administrative authority and cannot
be assigned a restrictive role. Custom roles **narrow the user's existing account
role** in this stage; a Staff account cannot become a Manager by selecting additional
permissions. Salon and other legacy ERP permissions remain controlled by the existing
account role. Managed-team record scopes belong to Stage 3.

Clearing Read clears the other actions for that entity. Other actions require Read.
Archive and reassignment through a record editor also require Edit. Report views
require Read on their source entities (activity overview: activities/opportunities;
sales reports: enquiries/opportunities/activities). Report exports additionally
require Reports > Export and Export on the exported source entity. Linked record names remain contextual labels; they do
not grant permission to open the linked entity or its lists.

### Enforcement and safety

- Typed permission requirements are mandatory at the CRM transaction boundary,
  including extension services, projects, document/PDF exports and custom fields.
- Archive and owner/team changes have separate action checks. Inline contact creation,
  generated follow-ups, preset items and inherited activity reassignment cannot bypass
  the permissions of the entity they modify. Required audits remain transactional.
- A single indexed join resolves the active user, tenant and optional role per service
  operation. No per-result permission queries or in-memory list filtering are added.
- The module response supplies permission caps for navigation, direct view guards,
  shared record editors, links, tabs and exports. Failed loading denies access. Server
  checks use current database assignments on every operation; focus refresh updates
  client controls without discarding an unchanged form.
- Role updates use versions; assignment updates compare the previous role. Roles with
  assigned users cannot be archived. Role names are unique within a tenant.
- Role creation/updates and assignments require the current active tenant ADMIN,
  even when the session still claims ADMIN. User creation/security updates recheck
  current authority, lock the tenant row and preserve the last active administrator.
- The additive migration creates `TenantAccessRole` and `TenantRoleAssignment` with
  composite tenant foreign keys, indexes and forced RLS. It rewrites no existing user
  roles or business records. Apply it before deploying the new permission queries.

### Local validation

Security service and actual API tests cover restrictive roles, stale sessions,
read-only access, denied exports, inline creation, follow-up rollback, tenant RLS,
role versions, assignment conflicts, audit failure and concurrent last-admin changes.
The real migration is exercised in a disposable schema. Existing CRM, team, project,
custom-field, quotation and module regression suites were also run locally.
The 10,000-row team and custom-field query limits still pass (12 and 13 statements
respectively in the isolated run). Role-editor desktop/mobile screenshots were
inspected; browser tests also verify denied views make no record-data request.
Production build, TypeScript and targeted lint pass (one pre-existing tenant-list
React dependency warning). Hosted data has not been changed.

```powershell
npm.cmd run test:access:integration
npm.cmd run test:users:integration
npm.cmd run test:crm
node node_modules/@playwright/test/cli.js test --config playwright.project-ui.config.ts access-roles.spec.ts
```

## Stage 3: record scopes and manager authority — planned

Add Own/Assigned, Managed teams and All tenant scopes, evaluated within the
resource's allowed actions. A team member does not automatically become a team
manager. Managers edit permitted records under their own identity without
changing the record owner. Apply scopes in indexed database predicates, including
all list, detail, count, export and relation paths. Tenant isolation remains
mandatory regardless of role or scope.

## Stage 4: audit review and local verification complete; hosted rollout pending

Provide protected, paginated audit review with actor, target, action, timestamp
and changed fields. Retain existing record timelines. Verify every role/scope
combination, module revocation and concurrent permission changes. Then extend
the catalog to legacy ERP modules after their service boundaries are covered.
Quotation discount/approval policies require a separate business decision and
are not assumed by this access-control rollout.


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

## Phase 4 - real local access verification (2026-10-04)

Ten real browser/API access scenarios passed against the production Next build
and disposable PostgreSQL using the non-bypass runtime role. Coverage includes
platform/tenant module controls, dependencies, CRM manager/team scopes, staff
ceilings, live permission revocation, concurrent edits, tenant isolation and
redacted audit detail. A suspended-account redirect loop was fixed and verified,
including recovery to a usable sign-in form and wrong-tenant session clearing.

Audit review and this local verification are complete; hosted rollout and broader
business-workflow verification remain pending. No push/deploy or hosted writes.
See ERP_STANDARDIZATION.md and BROWSER_TESTING.md for evidence and rerun steps.