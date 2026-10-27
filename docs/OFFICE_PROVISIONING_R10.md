# R10 phase 2C: account provisioning backend

This is a local milestone on `staging`, not the completed office-isolation
release. Operational ownership, assignment selectors and office UI
controls remain release prerequisites. No hosted database or deployment changed.

## New users

Tenant-admin `POST /api/users` accepts an optional `officeAccess` object:

```json
{
  "creationOfficeId": "explicit-office-id",
  "officeIds": ["explicit-office-id"],
  "companies": [{ "companyId": "explicit-company-id", "includeSubsidiaries": false }]
}
```

The object has no client-controlled policy version. Creation uses version zero
and cannot overwrite an existing policy. The same transaction writer now serves
membership administration and initial user creation. Fresh tenant-admin authority,
tenant ownership, active creation-office eligibility, explicit subsidiary coverage,
optimistic versioning and mandatory audit remain authoritative.

Account creation, access profiles, office policy, grants and security audit commit
together. Invalid/foreign/duplicate grants, a preference outside the effective
grants, or audit failure roll back the whole account. Customer or inactive accounts
cannot acquire office eligibility. Closed offices may retain explicitly granted
historical access, but cannot be selected as the creation office.

Omitting `officeAccess` creates an unassigned account: no office is inferred from
the creator, account label, team, supervisor or tenant's initial office. An explicit
empty object shape with empty arrays and a null preference is also supported.
Office eligibility grants no action permissions. Existing accounts, memberships,
assignments, snapshots and record owners are not rewritten.

Phase 2D8B exposes [initial office controls](OFFICE_ONBOARDING_UI_R10.md) in the
local user form and invitation form. Untouched controls still create an
unassigned account. The self-service workspace selector and complete R10
release/recovery gates remain required before hosted release.

## New tenants

The existing platform provisioning transaction now initializes the new tenant
administrator with one exact grant to its new initial office and selects that
office as its creation preference. It grants no company/descendant membership.
Tenant Admin retains the existing security oversight policy.

This is explicit bootstrap data written once during creation. It is not a runtime
default, a repair process or a role-based office fallback. Replaying bootstrap
against an existing policy returns a conflict and preserves the policy. The helper
rechecks the current active platform account and organization scope inside the
transaction. A membership/audit/settings failure rolls back the tenant and admin.

No new migration is needed for this milestone; pending migrations 112-114 remain
part of the unreleased R10 foundation.

## Verification

`npm.cmd run test:office-provisioning` runs the new provisioning, existing office
membership, user and tenant suites against a disposable local PostgreSQL database
with a nonprivileged RLS runtime role. It disables the single-office fixture grants
so missing memberships cannot be masked by old factories.

After `npm.cmd run build`, `npm.cmd run test:office-provisioning:browser` also uses
real Chrome sign-ins for a newly created staff account and a newly provisioned
tenant administrator. It checks the persisted office of their new CRM enquiries,
rejects an unauthorized office switch, and checks access after grant revocation.
These are authenticated flow checks, not a visual verification of new office UI.

Verified locally on 2026-10-25: 52 integration checks passed with no skips; the
real Chrome flow passed. Build, TypeScript and changed-file ESLint passed. The
existing module-list expectation in the tenant test was updated to include the
already registered Sales Orders and Receivables modules. No GitHub push, hosted
migration, deployment or client-data change was performed.

## Remaining release work

- Invitation onboarding now has [explicit office/profile proposals and atomic
  acceptance](INVITATION_ONBOARDING_R10.md). Phase 2D8B connects its office
  proposals to the form. Workspace selection remains pending; no memberships
  are inferred from the sender.
- Complete operational/workforce source ownership and privacy-safe scheduling
  conflicts, preserving personal leave and configured approval relationships.
- User memberships, initial office forms and self-service preferences are
  implemented locally in phases 2D8A/B/C. Complete combined workflow verification
  and the remaining release requirements, then external collaborators and attribution.
- Rehearse the whole release against a restore-tested backup copy and compare
  existing pilot access before hosted staging verification. Production remains a
  separately authorized release.
