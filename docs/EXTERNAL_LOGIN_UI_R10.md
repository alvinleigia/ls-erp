# R10 phase 3B2: external login-management screens

Implemented and verified locally on `staging`. Nothing is pushed or deployed;
hosted staging, production, pilot data and saved hosted sessions are unchanged.
This adds controls to the [phase 3B1 identity/lifecycle backend](EXTERNAL_LOGINS_R10.md),
without a new schema migration, dependency or authorization system.

## Tenant administrator usage

1. Open **Users > External collaborators**, then **Manage logins** for an entry.
   Login accounts and pending invitations have independent search and paging.
2. Choose **Create login** to set a person's name, email and temporary password,
   or **Invite login** to let the person choose a password through the existing
   acceptance flow. Invitations default to a private copyable link; email delivery
   is an explicit choice and uses the existing mail configuration.
3. Select business access profiles and record limits, and optionally grant office
   access. Leaving profiles or offices empty leaves that access unassigned; the
   supervisor relationship never supplies it. Each named login has its own grants.
4. Use **Access profiles** or **Office access** beside a login to open the shared
   editor for that fixed account. Review permissions before activating a login.
5. **Suspend**, **Activate**, **Archive login** and **Revoke invite** require
   confirmation. **Open invite link** recovers a still-pending link for private
   sharing; closing the result clears its transient display state.

An archived collaborator cannot receive new logins/invitations or have a login
activated. Restoring the directory entry leaves accounts suspended and old links
expired. Activate each desired account explicitly after reviewing its access.
External identity is displayed in ordinary user/invitation views; the user editor
cannot turn it into an employee, manager, customer or administrator.

## Shared contracts and failure handling

- Existing user, invitation, access-profile and office APIs remain authoritative.
  Administration refreshes actor authority; writes retain the tenant security lock,
  audit, native RLS and immutable external-identity checks from prior phases.
- The pure external permission mask is shared by client choices and the central
  server resolver. External profile search/count/paging excludes profiles with no
  usable business actions. Mixed profiles may be selected, but employee and
  internal-team-management actions remain masked on the server. Existing saved
  assignments remain visible for explicit review/removal.
- Assignment DTOs identify the account's external identity. The profile editor
  fixes the selected person when opened from a login row and uses the loaded
  identity to choose controls; it does not trust a supplied external flag.
- Invitation lists can filter the saved collaborator proposal within the current
  tenant. Count and page use the same predicate. Responses expose the identity
  link without returning the full access proposal.
- Lifecycle requests send optional `expectedStatus`. The shared user endpoint
  rejects stale status changes under its lock with 409. Profile conflicts preserve
  the draft and require **Reload saved access** before saving again. Fresh denied
  authority blocks submission. Existing API callers need not send the new field.
- Creation/invitation errors retain inputs and restore busy controls. Ambiguous
  transport failures ask the operator to check saved accounts/pending invitations
  before retrying. No automatic mutation retry or duplicate account workaround.
- Shared draft sheets retain discard confirmation and fixed mobile footers. Links
  and passwords are not persisted in browser storage or logged by these controls.

Supervisor responsibility, action permissions, record scope, office membership
and employment remain separate concepts across industries. These screens do not
attribute sales to partners or change KPI populations.

## Verification recorded locally

- `npm.cmd run test:external-login-ui`: **91 tests passed**, no failures or skips,
  using real route handlers and non-bypass runtime access in disposable PostgreSQL.
- **12 distinct Chrome flows passed** across the combined regression run and the
  corrected focused rerun. All three new login-screen flows then passed together.
  Coverage includes actual partner sign-in, invitation acceptance/revocation,
  profile removal/restoration and conflicts, office grants, stale status, archive/
  restore, denied authority, transport failures, empty grants and mobile drafts.
  The initial combined run's remaining failure was a test demoting its operator
  before the office check made Save ready; it was corrected to test server rejection
  from a ready stale form. It is not counted as a pass from that initial run.
- All **131 migrations** rehearsed successfully, including forced rollback/source
  preservation and **18 native stock checks**. No new migration in this phase.
- Build, TypeScript, changed-source ESLint and whitespace checks passed. Desktop
  and 390px mobile viewport screenshots were inspected; mobile Save/Cancel remain
  fully in the viewport and the page has no horizontal overflow.
- Older access-profile tests now explicitly grant synthetic office memberships
  through the shared membership service. The external suite keeps all three
  historical office/booking/daily fixture adapters disabled; runtime access is
  unchanged. Synthetic local accounts only; no hosted fixture/reset scripts.

Ignored local evidence under `tmp/industry-release`: API/migration run
`ls-erp-sales-orders-2e66823b65de.log`, `phase3b2-build.log`,
`phase3b2-browser.log`, `phase3b2-browser-focused.log` and
`phase3b2-browser-final.log`. Screenshots are under `test-results/local-access`.

## Next phase and release boundary

**Phase 4: partner attribution and reporting/KPI separation.** Keep introducer,
responsible salesperson, supervisor and source company/office independent;
preserve attribution through reassignment and count company outcomes once.

Before hosted staging, take and restore-test a fresh encrypted backup, rehearse
all migrations against a copy and compare pilot IDs, owners and effective access.
Production requires its own authorized release. Local checks do not replace these
recovery and hosted verification gates.
