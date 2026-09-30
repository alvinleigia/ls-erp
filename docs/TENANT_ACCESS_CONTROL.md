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

## Stage 4: audit review and rollout — planned

Provide protected, paginated audit review with actor, target, action, timestamp
and changed fields. Retain existing record timelines. Verify every role/scope
combination, module revocation and concurrent permission changes. Then extend
the catalog to legacy ERP modules after their service boundaries are covered.
Quotation discount/approval policies require a separate business decision and
are not assumed by this access-control rollout.
