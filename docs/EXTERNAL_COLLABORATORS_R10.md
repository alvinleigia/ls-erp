# R10 phase 3A: external collaborator directory

Local work on `staging`. Hosted staging and production are unchanged. This is the
shared identity-directory foundation; login linking and partner reporting follow
in separate bounded phases.

## Usage

A Tenant Admin opens **Users > External collaborators > New collaborator**.
Enter a name, stable code and classification (for example Channel partner, Agent
or Consultant), then choose an active internal manager or administrator. Contact
email, phone and an agency/business display name are optional. Save creates one
external identity, without a User, StaffProfile, invitation or business record.

The organization name is descriptive text, not an operating company, platform
Organization or CRM-account association. A later agency association must have
its own authorized party lookup; this field confers no ownership or access.

The list supports server paging, search and active/archived filters. Reopen an
entry to edit details, change supervisor or archive it. Records and codes remain
stable. A conflicting save returns 409 and retains the form; **Reload saved
details** explicitly replaces the draft with current saved values.

A supervisor relationship records responsibility only. It never grants the
partner the supervisor's permissions, teams, companies, offices or records, nor
does it grant a manager access to the admin-only partner directory. Existing
employee reporting managers and leave approval relationships remain separate.

If a supervisor is suspended or no longer a manager/administrator, retain the
saved relationship and show it as unavailable. Do not silently substitute an
administrator. New assignments and restoration from archive require a currently
eligible supervisor. Archiving or correcting contact details remains possible.

## Shared implementation and security

`platform/collaborators` owns validation, transactional administration and the UI;
`/api/collaborators` and its detail/supervisor endpoints use the shared business
API. No industry module, new authorization role, default action profile or tenant
exception is introduced. The schema model is classified under the existing
security-owned user resource, and collaborator audits are registered as an
admin-only security event family.

All routes refresh current tenant/account authority. Writes serialize through
the tenant security lock before rechecking the operator and proposed supervisor.
Supervisor choices are paged and searched within that same tenant/active-role
population. Managers/staff cannot browse choices or directory records through
broad business profiles. Platform-console accounts cannot use these business APIs.

Forced RLS protects directory rows and before/after audit copies. An additional
audit policy covers both the event prefix and entity type. Tenant-scoped foreign
keys prevent foreign supervisors; a database trigger protects immutable identity
and assignment eligibility. Ordinary runtime actors cannot hard-delete rows.
Creation and every update commit their mandatory audit in the same transaction;
audit failure rolls back the complete business change.

## Migration and verification

Migration 130, `20261027000100_external_collaborators`, adds one table and its
constraints/indexes/trigger/policies. It performs no identity, login, employment,
permission, membership, source or KPI backfill. Existing identities and access
remain untouched. A disposable rehearsal verifies forced rollback and exact
equality of all preceding business tables and existing policies.

Run `npm.cmd run test:collaborators`. Build first, then run
`npm.cmd run test:collaborators:browser` for real Chrome flows in the isolated
local application. Both use a guarded disposable Docker database. Historical
single-office, daily and booking fixture adapters remain disabled. No hosted
credentials, database fixtures or saved client sessions are used.

## Verified locally

- 69 distinct API/access/resource checks passed with no skips: the 68-check
  combined run plus a subsequent 14-check focused run covering the final
  supervisor-caption behavior and one additional whole-tenant cleanup case.
- Six distinct real-sign-in Chrome flows passed: four existing office-onboarding
  flows and two collaborator journeys. The latter were rerun after correcting
  test selectors and waiting for archive completion before reading its version.
- All 130 migrations were rehearsed in disposable PostgreSQL, including forced
  rollback, equality of all 131 preceding tables/policies, and the existing 18
  native Inventory preservation checks.
- Prisma validation/generation, TypeScript, changed-source ESLint, whitespace
  checks and production build passed. Desktop/mobile screenshots were inspected; the mobile form has no horizontal
  overflow. Images are retained under `test-results/local-access`.

Evidence is local and ignored: `tmp/industry-release/ls-erp-sales-orders-f02edd868f56.log`,
`phase3a-focused.log`, `phase3a-browser.log`, `phase3a-browser-focused.log` and
`phase3a-build.log` in that directory. Earlier failing runs are retained as evidence;
no failed test or skipped check is counted as a pass.

## Next bounded phase

[Phase 3B1](EXTERNAL_LOGINS_R10.md) implements the local identity/lifecycle backend
and verifies existing real sign-in and invitation acceptance. Dedicated login
management controls remain phase 3B2.

Phase 3B connects explicit external login identities to collaborators without
reusing employee profiles. One collaborator may have multiple named logins;
login lifecycle, invitation acceptance, suspension and archive must use the shared
security transaction and immediately revoke current access. Do not infer identity
from email or silently convert existing staff/accounts. Verify all workforce,
assignment, profile, office and supervisor selectors before enabling partner login.

Phase 4 keeps introducer, responsible user, supervisor and source office separate
for attribution/reporting. Outcomes count once in company totals, with explicit
partner/employee breakdowns. This directory alone changes no KPI population.
Hosted staging still requires a fresh encrypted restore-tested backup, full
migration rehearsal and pilot ID/owner/access comparisons. Production requires
its own authorized release. None of those gates is replaced by local tests.
