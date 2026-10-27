# R10 phase 2A: office membership and context backend

This is the shared membership engine, implemented locally on `staging`.
It is not the completed office-isolation release. Phase 2B now connects
[sales record ownership and office RLS](SALES_OFFICE_OWNERSHIP_R10.md) while
retaining R9 rules. Later local phases cover operational families and provisioning.
Phase 2D8A adds the [admin editor](OFFICE_MEMBERSHIP_UI_R10.md); initial-access
forms are implemented in phase 2D8B and the [workspace selector](WORKSPACE_OFFICE_UI_R10.md)
is implemented in 2D8C. Complete the release contract before deploying these phases to clients.

## Membership contract

- An exact office grant includes only that office.
- A company grant includes offices belonging to that company, including future
  offices. Subsidiaries are included only when `includeSubsidiaries` is explicit.
  Parent placement does not grant access in the other direction.
- Several grants combine as a set. They grant no action permissions, employee
  status, team management, approval authority or selected-record sharing.
- Tenant Admin retains security oversight across its tenant. Staff/Manager labels
  alone grant no office eligibility. Ordinary users cannot change memberships.
- A creation-office preference must refer to an accessible, active office. It
  cannot create a grant. Clearing or losing a preference has no implicit fallback.
- Closing an office removes it from creation choices. It does not erase explicitly
  authorized historical eligibility. Revoking memberships is a separate action.
  Archived company/office grants can be retained or explicitly assigned for
  historical access, subject to future source/action policies.
- Company reparenting re-evaluates explicitly selected subsidiary coverage on the
  next request. Account and tenant suspension invalidate eligibility immediately.

The resolver uses current database state. It does not cache office permissions in
JWTs, infer membership from managers/teams, or introduce tenant-specific overrides.
It is industry-neutral and will also apply to external collaborator identities.

## Storage and migration

Migration 113, `20261026000200_office_membership`, adds:

- `BusinessOfficePolicy`: user preference and optimistic policy version.
- `BusinessOfficeGrant`: exact office memberships.
- `BusinessCompanyGrant`: company memberships with explicit subsidiary coverage.

Existing tenant-owned users receive their initial office as ordinary persisted
grant data. No company/descendant grant is created. All 122 preceding tables,
including IDs, owners, profiles, teams, sharing, values and financial snapshots,
remain unchanged. New unassigned users have no policy/grants and no implicit
office. The [direct user/tenant provisioning backend](OFFICE_PROVISIONING_R10.md)
now accepts explicit memberships, with [invitation onboarding](INVITATION_ONBOARDING_R10.md)
implemented as well. User/workspace controls and complete module coverage remain
required before the native office record-enforcement release is deployed.

Composite foreign keys enforce tenant identity. Office/company references are
checked at transaction commit so privileged whole-tenant maintenance cleanup can
finish cascading through users and policies. Orphan/cross-tenant references still
fail the transaction. Ordinary user lifecycle continues to use soft status changes.

Forced RLS protects all three tables. Active users can read only their own policy
and grants; active Tenant Admin can administer their tenant. Administrative writes
serialize with account, hierarchy and preference changes on the tenant row.
Version conflicts return HTTP 409. No write silently replaces newer changes.

## Server entry points

`platform/companies/office-access.ts` owns validation, fresh authorization, grant
replacement, preference selection and auditing. HTTP adapters use the ordinary
authenticated tenant wrapper:

| Endpoint | Authorization and behavior |
| --- | --- |
| `GET/PATCH /api/access/users/:id/offices` | Tenant Admin; versioned membership administration |
| `GET /api/workspace/offices` | Current business user; paginated active creation choices with bounded search/sort |
| `GET/PATCH /api/workspace/office` | Current business user; own effective creation preference only |

These endpoints do not authorize business-record actions. Phase 2D8A connects
the membership API to local user management and adds its read-only draft creation
choice endpoint; see `OFFICE_MEMBERSHIP_UI_R10.md`. Hosted release remains gated.

Database helpers under the unexposed `app` schema bind the authenticated actor and
tenant even when invoked from a security-definer function:

- `business_office_access`: eligibility, including retained historical grants.
- `business_office_allowed`: narrower active creation-office eligibility.
- `business_office_choices`: permitted active office/company names only.
- `select_creation_office`: versioned self preference; no grant mutations.

Ordinary users cannot use a target-user parameter to inspect someone else's
eligible offices. Preference changes use a narrow database function because direct
policy-row updates remain administrator-only. The function rechecks authority
after the tenant lock and inserts its mandatory audit event in the same statement.
Audit failure rolls back the preference. Membership replacement and its mandatory
audit event share the server transaction. Audit copies remain administrator-only
for membership changes and self/Admin-only for preference changes.

## Remaining phase 2 work

Phase 2D7C now provides the executable ownership/model registration and workspace
readiness review in `RESOURCE_OWNERSHIP_R10.md`. Phase 2D8A implements the
local admin membership editor; 2D8B connects initial provisioning forms and
2D8C adds self-service creation-office controls. Combined workflow verification
and release/recovery gates remain.

1. Sales roots and canonical children now have native ownership in phase 2B.
   Complete the operational families and personal/conflict paths, retaining the
   initial-office backfill and all existing responsibility/sharing relationships.
2. Use one exhaustive resource registry for office-owned, source-inherited,
   deliberately tenant-shared reference/security data, and composed reports.
   Office eligibility must intersect profiles, actions, record rules, activation
   and Restricted/source visibility on every route and in restrictive RLS.
3. Cover CRM/projects, sales/financial children, import/history/custom values,
   workforce, bookings and purchasing. Preserve privacy-safe stock/reservation and
   scheduling conflict enforcement across offices; hidden data must not appear in
   dashboards, exports, selectors, generated documents or audit copies.
4. Connect explicit user provisioning and workspace UI only after those adapters
   are enforced. Bind the expected office and policy version to each business
   request; changing a preference in another tab must not silently reroute an
   unfinished creation form. Revalidate office/source eligibility in its write
   transaction. Linked financial records keep their canonical source office,
   independently of the actor's creation preference.
   Test multi-office managers, head office, revocation, closed-office
   history and future external collaborators without changing core tenancy.
5. Restore-test a fresh backup, rehearse against a copy, compare current client
   visibility, then verify the complete release on hosted staging. Production
   remains a separate authorized release.

## Verification

`npm.cmd run test:office-access` uses guarded, disposable local PostgreSQL only.
Migration checks force a rollback, compare every preceding table exactly and
validate the initial-office backfill. Service tests use a nonprivileged runtime
role and cover scope composition, explicit subsidiaries, reparenting, future
offices, no action expansion, no fallback, lifecycle, foreign references,
concurrency, RLS, audit rollback and maintenance cleanup.

After `npm.cmd run build`, `npm.cmd run test:office-access:browser` also tests the
authenticated HTTP flows with real Chrome and isolated synthetic tenants. These
are API/session checks; they do not claim native office-record isolation or a new
workspace UI. No hosted credentials or client data are used by these test runners.

Verified locally on 2026-10-25: 22 membership/context integration tests and the
authenticated real-Chrome API flow passed. The existing ERP access suite passed
258 checks with two historical-only skips. Migration rollback, exact preservation
of the 122 preceding tables, deferred-FK integrity and whole-tenant cleanup passed.
Build, TypeScript, schema validation and changed-source lint passed. No GitHub
push, hosted migration, staging deployment or production change was performed.
