# R10 phase 2C: invitation onboarding

Local implementation on `staging`. This is not the completed office-isolation
release: operational ownership, assignment selectors and office controls remain
prerequisites. No hosted migration or deployment is included.

## Administration and delivery

Tenant administrators can select Staff/Manager access profiles when inviting a
new account. Send email remains the default; Create link creates a pending
invitation without SMTP. The admin can copy its link from the invitation list.
Email delivery failures explicitly report that the invitation was saved and its
link can be copied. Missing/disabled email configuration rejects email delivery
before saving an invitation.

`POST /api/invites` accepts `accessRoleIds`, `recordRules`, optional `officeAccess`
and `delivery` (`EMAIL` or `LINK`). Office proposals use the same exact-office,
company and explicit-subsidiary schema as direct user creation. Office controls
are still not exposed in the invite form; the UI's omission grants no office
membership. No sender office, team or supervisor is copied implicitly.

Email addresses are normalized for new invitations. Existing accounts and
case-insensitive duplicate pending invitations are rejected. Use account
management/password reset for an existing user. A pending invitation must be
revoked before replacing it; an expired one can be replaced. Accepted invitations
remain history and cannot be revoked in place: manage the resulting account.

Invitation links use the authenticated forwarded tenant host and protocol,
including development ports, rather than Next's internal listening URL.
Revocation uses the shared confirmation dialog. Administration and token-bearing
responses require a fresh tenant-admin account and use `Cache-Control: no-store`.

## Acceptance and security

Invitations create new accounts only. They never update an existing password,
name, account role, profiles or office policy. Acceptance accepts only token,
name and password; browser-supplied role, profiles or offices are rejected.

The service locks the tenant, identifies the exact pending secret through the
narrow database capability function, locks the invitation, and rechecks the
current inviter's active administrator authority. No application RLS bypass is
used by public acceptance. The database function returns only invitation/issuer
IDs for an exact, unexpired token in the current tenant; it cannot enumerate
invitations or select a different administrator.

Profiles, creation-office eligibility and effective proposed membership are
validated at issue and again at acceptance. Archived profiles, closed creation
offices, foreign references, invalid configuration and changed company placement
cannot silently grant access. Suspended/demoted inviters and suspended tenants
invalidate pending onboarding. No profile/office proposal means no such grant.

Account creation, profile policy, grants, membership audit, account audit and
one-use token consumption commit together. Acceptance and revocation share the
tenant lock; only one concurrent acceptance can commit. Audit failure rolls back
the whole operation. Audit snapshots exclude passwords and tokens. Forced RLS
restricts invitation rows and their audit copies to current administrators.

## Migration and verification

Migration 115, `20261026000400_invitation_onboarding`, adds the invitation's
`accessConfiguration` JSON object and security policies/capability function.
Existing invitations receive an empty access proposal. The migration changes no
existing email, token, acceptance status, password, user/profile/grant, business
record, owner, timestamp or frozen financial content. There is no runtime
compatibility switch or migration fallback.

`npm.cmd run test:invitations` uses only guarded disposable local PostgreSQL with
a nonprivileged runtime role. Its rehearsal forces a rollback, compares all 125
preceding tables (excluding only the new JSON column), and includes populated
pending and accepted invitations. Tests cover authorization, case-insensitive
duplicates, no existing-account overwrite, explicit grants, input forgery, direct
RLS, expiry/revocation, fresh authority, concurrency and mandatory audit rollback.
Existing account provisioning, office membership, users, tenants and core access
checks run in the same suite. SMTP success/failure tests use local doubles only.

After building, `npm.cmd run test:invitations:browser` additionally exercises the
actual invite form, mobile controls, revocation confirmation, password setup,
real sign-in, office-bound CRM creation and replay denial. Screenshots must be
inspected before claiming visual verification.

Verified locally on 2026-10-25: 76 integration checks passed with no skips; the
final Chrome flow passed in 8 seconds. Desktop/mobile screenshots were inspected.
Build, TypeScript and whitespace checks passed. Changed-file ESLint passed with
one existing unused inline suppression warning in the invitation list. The
browser check caught and verified the forwarded-host link correction; its final
checks use actual screen completion, sign-in and persisted record ownership.
Evidence is retained in ignored `tmp/industry-release` logs. No GitHub push,
hosted database change, deployment or client-data mutation was performed.

The full R10 release still requires restore-tested backup rehearsal, comparison
of pilot access, complete module coverage and hosted staging verification.
