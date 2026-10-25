# R10: operating companies, offices and external collaborators

## Agreed model

The tenant is the client/business-group security boundary. Platform
`Organization` continues to group tenant accounts for control-plane administration;
it does not grant cross-tenant access to business records.

Within a tenant, companies represent operating/legal entities, subsidiaries have
an optional parent company, and each office/branch belongs to exactly one company.
An office does not become a separate tenant or a separate authentication system.
This structure is independent of industry. Real Estate remains an add-on.

## Phase 1: directory foundation

Implemented locally on the staging branch:

- Tenant administrators manage companies and offices under **Settings > Companies
  and offices**, through the shared platform service and tenant-scoped APIs.
- A company can be independent or have an active parent in the same tenant.
  Cycles and cross-tenant links are rejected. An office cannot change company.
- Codes are normalized, stable and unique per tenant/company as appropriate.
  Updates use version checks; concurrent stale saves return a conflict.
- Records are archived, not deleted. A company with active subsidiaries/offices
  cannot be archived. The initial company and initial office remain active.
- Administration rechecks current account and tenant authority inside each
  transaction. Writes serialize with tenant security administration and commit
  mandatory before/after audit events in the same transaction.
- Forced RLS protects both tables and their audit copies. Staff/Manager labels
  and general audit profiles do not confer directory access. No new business
  permission aliases, runtime compatibility flags or tenant exceptions are added.

Migration 112, `20261026000100_company_office_structure`, adds two tables and one
initial company/office pair for each existing tenant. It does not update any
existing business, user, owner, membership, sharing, permission or module row.
Future tenant provisioning creates the same pair atomically through a database
trigger. Provisioning rollback removes the pair as part of that transaction.

**This phase does not enable company/office record isolation, membership,
consolidation or partner logins.** The UI describes the directory boundary.
Existing access remains authoritative until phase 2 converts records and
membership together. Do not treat a company/office name as an access grant.

## Phase 2: shared organizational record scope

Phase 2A has the local [membership and context backend](OFFICE_MEMBERSHIP_R10.md).
Phase 2B connects [native office ownership for sales records](SALES_OFFICE_OWNERSHIP_R10.md)
to CRM, projects, quotations, orders and financial children. Phase 2C adds the
[user and tenant account provisioning backend](OFFICE_PROVISIONING_R10.md).
Operational families, invitation onboarding, assignment selectors and workspace
controls remain prerequisites before exposing office controls or deploying the
office-isolation release.

Add explicit company/office membership and permitted head-office oversight;
intersect organizational scope with existing action profiles, record rules,
selected sharing, source privacy and module activation. Parent placement alone
must never grant authority. A UI/report filter only narrows permitted records.

Use one resource registry defining each module's ownership root and inherited
children. Cover lists, details, writes, assignment selectors, reports, exports,
dashboards, RLS, audit/history, custom fields and document snapshots together.
Define intentional tenant-shared configuration separately from operational data.
Financial children inherit their canonical sales source. Stock and scheduling
conflicts must remain enforceable without exposing unauthorized records.

Backfill existing pilot data and current business users into the initial
company/office with unchanged IDs, responsible users, teams, profiles and record
sharing. Preserve the current access matrix, then test company isolation using
new synthetic offices. No role fallback or permanent migration adapter.

## Phase 3: external collaborators

Add an industry-neutral external collaborator identity with optional agency/party
association and one or more linked login accounts. "Channel partner" is a
tenant-facing classification, not a new Real Estate authorization system.

Keep employee status, permission profiles and supervisory responsibility
separate. An external collaborator is not an HR employee and receives no leave,
roster, workforce directory or broad business access by default. Use explicit
profiles and assignments/sharing, bounded by organizational membership. Changing
a supervisor must not grant the collaborator that supervisor's access.

Use a separate, auditable supervisor relationship to an eligible internal user;
do not reuse the employee leave-approval manager field. Invitations, suspension,
offboarding and reassignment must use the same identity/access lifecycle as other
business accounts, without orphaning source records or silently expanding access.

## Phase 4: attribution and release verification

Keep introducing collaborator, responsible salesperson, supervising manager and
record company/office as separate dimensions. Preserve source attribution through
reassignment; count business outcomes once in company totals. Employee activity
measures employee actions; partner results and supervised portfolio totals have
explicit reporting filters and drill-downs.

Before enabling phases 2-4 on hosted staging, take a fresh encrypted, restore-
tested backup and rehearse migrations against a copy. Compare existing client
record IDs/owners/access before and after. Verify ordinary staff, multiple-team
managers, head-office membership, restricted sharing, external users, revocation,
cross-company attempts and every module's source/financial boundaries.
Production requires a separate authorized release with verified recovery evidence.

## Local verification

`npm.cmd run test:companies` uses an isolated Docker PostgreSQL database only.
The migration helper tests a forced rollback, exact equality of all 120 prior
business tables, initial backfill and forced RLS. Service tests exercise hierarchy,
fresh authority, tenant boundaries, archival, concurrency, immutable identities,
audit rollback and runtime RLS with a nonprivileged role.

`npm.cmd run test:companies:browser` additionally uses real Chrome against the
isolated local application. It covers company/office creation, parent selection,
archive conflict, stale save, desktop/mobile rendering and staff denial.
Run `npm.cmd run build` before the browser suite. Screenshots must be inspected
before claiming visual verification.

Verified locally on 2026-10-25: 15 company/office service tests passed, 258 existing
ERP access checks passed with two historical-only skips, and the real-Chrome flow
passed. Desktop and mobile screenshots were inspected. Schema validation, build,
TypeScript, changed-source ESLint and whitespace checks passed. The regression
run found a maintenance-cleanup foreign-key issue; the final migration preserves
company/office reference checks while allowing the existing privileged tenant
cleanup transaction to remove its structure. No business authorization was relaxed.

No production deployment or database change is part of phase 1 implementation.
