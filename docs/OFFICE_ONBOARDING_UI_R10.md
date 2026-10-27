# R10 phase 2D8B: initial office access in onboarding forms

Implemented locally on `staging`. No migration, account backfill, hosted change,
push or deployment is included. Complete the R10 staging/recovery release gates
before exposing office enforcement to clients.

## Use

Tenant Admin can configure **Initial office access** in **Users > New user** and
**Users > Invites > Invite user** for Admin, Manager or Staff accounts.

1. Add specific offices or companies. Each company has an explicit subsidiary
   checkbox, initially off. Closed grants can authorize retained history.
2. Optionally choose an active creation office covered by those grants. Tenant
   administrators retain oversight of every office regardless of grant choices.
3. Create the account, or issue the invitation by the existing email/link choice.
   Invitations save a proposal; the account and grants are created only at
   acceptance, after fresh validation. Tests use link delivery without SMTP.

Leaving the controls untouched creates no office policy, grants or preference.
An explicitly empty draft also grants no office access. Nothing is inferred from
the creator, initial tenant office, manager or team. Office eligibility grants
no profile action, employee workplace, team membership or approval authority.
Profiles and record limits remain separate controls. Existing account editing
continues through the versioned office-membership editor.

Switching a new account to Customer or an inactive status clears its proposed
office grants and hides those controls. Switching back starts empty. Business
role changes retain explicit office choices but invalidate the preview; an Admin
creation preference must be covered by grants when changing to Staff/Manager.
Profile selections reset on role changes. Invalid preferences remain visible
with a correction prompt; they are not silently reassigned or dropped.

Cancel writes no account, invitation or grants. Opening a new form starts fresh.
The forms freeze during submission. Validation failures preserve the draft and
refresh eligibility. Authentication/authorization denial hides office controls
and prevents submission. Transport failures preserve the draft, release the
controls and ask the administrator to check the list before trying again. No
account/invitation request is retried automatically.

Both dialogs bound scrolling to their field area and keep the title and action
footer visible on mobile, including the long profile/record-limit configuration.

## Shared implementation

`OfficeMembershipFields` supplies the same office/company/creation controls to
existing membership administration and initial onboarding. `MembershipChoice`
keys responses/validation to the subject, draft, query, page and refresh so a
preview for another role or draft cannot enable the current submission. Existing
paging, cancellation, closed captions and off-page selected-label behavior remain.

`POST /api/access/initial-office-choices` is read-only and Tenant Admin only. It
accepts the existing bounded creation-choice fields plus explicit proposed role
and status. These describe a new account, never the caller's authority. Fresh
caller authority, tenant isolation and the shared tenant security lock remain
mandatory. Existing-user and new-account previews call one server resolver and
membership validator; the endpoint cannot create an account, grant, policy,
audit or preference. Unknown authority fields, foreign grants, duplicate IDs,
unsupported roles/status and unbounded inputs are rejected.

Actual creation and invitation acceptance retain the existing transactional
writers and mandatory audits. They recheck current company placement, office
activity and proposed coverage regardless of a successful earlier preview. A
closed preference or invalid grant rolls back the complete save. Public
acceptance still accepts only token/name/password, with one-use consumption and
no current-account overwrite.

## Verification

Verified locally on 2026-10-27:

- 88 integration checks passed, with no skips, across initial/existing draft
  preview, memberships, direct provisioning, invitations, users, tenant creation
  and core permissions. Runtime connections enforce RLS. New-account previews
  match existing-user choices and leave accounts, grants, policies and audits
  unchanged; foreign/duplicate/forged input and stale caller roles fail closed.
- Eight real-sign-in Chrome flows passed. Four new onboarding flows cover exact
  grants, closed-office rejection with account rollback and draft recovery,
  successful login/office-bound CRM creation, no invented workplace assignment,
  role/status clearing, cancellation, unassigned creation, company subsidiaries,
  invitation proposal/one-use acceptance and injected transport failures for both
  forms. Existing invitation, membership and provisioning flows also passed.
- Desktop/mobile screenshots were inspected. Mobile footer actions are asserted
  within the viewport. The test caught a scroll-container defect; both dialogs now
  bound scrolling to their fields rather than scrolling the whole dialog.
- The disposable 129-migration rehearsal, rollback/preservation checks and all
  18 Inventory native checks passed. Production build, TypeScript, changed-file
  ESLint and whitespace checks passed. No skipped checks count as passing.

The broader regression run now gives its permission-focused core fixture an
explicit initial-office grant and creation preference, rather than relying on
compatibility fixture grants. The office audit assertion identifies the returned
policy version, avoiding an unordered query's incidental row order. These are
test corrections; runtime access defaults and historical grants are unchanged.

Run `npm.cmd run test:office-onboarding-ui`, or build then run
`npm.cmd run test:office-onboarding-ui:browser`. These commands use isolated local
PostgreSQL and synthetic sign-ins only. Evidence is retained under ignored
`tmp/industry-release/phase2d8b-*.log` and `test-results/local-access` paths.

## Next bounded work

Phase 2D8C now adds the [creation-office selector](WORKSPACE_OFFICE_UI_R10.md).
It preserves memberships, saved offices, source Read and captured draft versions.
Combined workflow verification, external collaborators and the full staged
release remain later R10 work.
