# R10 phase 3B1: external login identity and lifecycle backend

Local implementation on `staging`; hosted staging and production are unchanged.
This slice verifies the backend and existing real sign-in/acceptance flows.
The dedicated [partner login-management screens](EXTERNAL_LOGIN_UI_R10.md) are now
implemented and verified locally in phase 3B2.

## Explicit identity

`User.collaboratorId` is an optional same-tenant relationship to an external
collaborator. A collaborator may have several distinct named login accounts.
Existing accounts retain a null link; no email matching, conversion or backfill
changes existing employees, customers, record owners, teams or access grants.
A new external account uses the existing business Staff authorization role with
explicit profiles. This role is not proof of employment. External identity is
immutable and cannot be switched to internal, customer, manager or administrator.

Direct creation accepts `collaboratorId` in the existing `/api/users` request.
Invitations accept it in their access proposal; acceptance validates the active
same-tenant collaborator again under the tenant security lock before creating
an account. No account is created or changed based on a matching contact email.
Password reset, account status administration, profiles and office membership
remain the ordinary shared flows. No new authorization role is introduced.

Absent explicit profiles and organizational grants, a new external account has
no business-record access. Supervisor assignment supplies no profiles, teams,
offices, shared records or reporting authority. Lists/details/writes retain their
existing action, record-rule, sharing, source-office and activation predicates.

## Lifecycle and recovery from archive

Archiving a collaborator atomically suspends its Active/Invited accounts and
expires its still-pending invitations. Required audit rows record actual account
status transitions and invitation expiry without passwords or invitation tokens.
Failure of either audit or the parent update rolls the entire transaction back.
Expired invitation links remain expired after restoration.

Restoring the collaborator does not reactivate accounts. A tenant administrator
must explicitly activate each desired login through the shared account flow.
Activation while the collaborator is archived is rejected. Suspended accounts
fail fresh authorization even with an existing JWT, and credential sign-in fails.
This uses the existing account-status session contract; it does not introduce a
separate external session system or silently change internal account behavior.

`GET /api/collaborators/:id/logins` is an administrator-only, paged/searchable
account summary. It returns identity/status fields without password hashes,
credentials, employee profiles or access configuration. It remains available to
administrators for archived directory entries and never broadens source Read.

## Employee boundaries

The central access resolver removes Leaves/Shifts and user-directory actions for
external identities even if a reusable profile later includes them. Internal team
configuration/membership writes are unavailable; ordinary team Read remains
explicitly grantable for business record scope. No employee profile, leave manager,
service eligibility, workplace, schedule or booking staff identity is created.

Database guards reject external employee profiles, reporting relationships,
service eligibility and internal team leadership, including SQL writes. External
actors have additional restrictive workforce/team-write/audit policies. Native
leave/workforce/workplace capabilities require an internal identity. Private
availability/conflict/working-time projections allow external use through current
explicit booking capability only; employee profile permissions cannot substitute.
Hidden source leave/bookings still block authorized booking work.

The active-staff dashboard count excludes external accounts. No other partner
attribution or employee-vs-partner sales KPI split is claimed here; phase 4 owns
those dimensions and must count company outcomes once.

Existing user DTOs include the link for correct identity display. Staff profile
buttons are hidden for external accounts and direct employee-profile pages reject
them. Manager choices exclude external identities. The dedicated creation/linking,
invitation and lifecycle UI is covered by [phase 3B2](EXTERNAL_LOGIN_UI_R10.md).

## Migration and local checks

Migration 131, `20261027000200_external_login_identity`, adds the nullable User
link, immutable identity/integrity triggers, atomic archive lifecycle and external
boundaries. All 132 preceding tables retain their data after excluding only the
new nullable User field. Existing policy definitions are unchanged; additional
restrictive policies narrow external access. The six existing capability/integrity
functions retain their internal behavior and grants, with explicit external
conditions. Forced rollback and source equality are rehearsed in disposable
PostgreSQL. No permanent migration adapter or tenant override is introduced.

Run `npm.cmd run test:external-logins`; build first, then run
`npm.cmd run test:external-logins:browser` for local real-sign-in flows. The runner
uses only guarded disposable Docker PostgreSQL and synthetic accounts, with all
three historical office/booking/daily fixture adapters disabled.

New employee-owned resources must use this shared identity boundary as well as
action/source authorization and native RLS. Register them in the common resource
contract and add external denial and internal preservation cases; a role label
must never be used to infer employment.

## Verification recorded locally

- 108 distinct API/access/resource checks passed without skips: 107 in the final
  combined rehearsal and ten in the focused identity/lifecycle rerun, including
  one additional whole-tenant cleanup case for linked accounts.
- Four real-sign-in Chrome flows passed against the final isolated database:
  directory supervision/archive/stale drafts, explicit partner business access,
  employee-route denial, archive blocking existing sessions and credentials,
  explicit reactivation and invitation acceptance/expiry after restore.
- All 131 migrations were rehearsed. Forced rollback and exact preservation of
  the 132 preceding tables (excluding only the new nullable User field), existing
  policies and internal function semantics passed. The existing 18 native stock
  preservation/integrity checks also passed.
- Prisma validation/generation, build, TypeScript, changed-source ESLint and
  whitespace checks passed. Existing directory desktop/mobile screenshots were
  inspected; employee/profile control absence is asserted in the browser flow.

Evidence is ignored/local under `tmp/industry-release`: the migration/API run
`ls-erp-sales-orders-c77b63ab752b.log`, `phase3b1-focused.log`,
`phase3b1-browser-final.log`, and `phase3b1-build.log`. Screenshots live under
`test-results/local-access`. Earlier failed comparisons/test expectations were
corrected; they are not counted as passes.

Before hosted staging, take and restore-test a fresh encrypted backup, rehearse
all migrations against a copy and compare pilot IDs/owners/access. Production
requires its own authorized release. Local verification does not replace these gates.
