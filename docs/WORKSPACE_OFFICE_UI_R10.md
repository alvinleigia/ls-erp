# R10 phase 2D8C: self-service creation-office selection

Implemented locally on `staging`. No schema migration, data backfill, hosted
write, push or deployment is included. The complete R10 staging/recovery release
contract remains required before clients receive office enforcement.

## Use

Business users open **Change creation office** beside the sidebar toggle. Search
and page through their eligible active offices, select one and choose **Apply
creation office**. **No creation office** explicitly clears the preference. An
unassigned account sees no eligible offices; neither the first row nor the initial
tenant office is selected implicitly. Customer and platform-console layouts do
not expose the control. Tenant Admin retains its existing all-office oversight.

The preference applies to new independent records. Linked work retains its source
office, edits retain their saved office, and existing action profiles, record
rules, memberships, workplace placement, teams and approvals remain authoritative.
This control is not a global Read or report filter. Existing office-specific stock
views keep their own office-context behavior; the selector does not reload or
remap the current page, charts, reports or open business drafts.

Cancel leaves the database unchanged; dirty cancellation uses the shared discard
dialog. Unchanged choices cannot be applied. A stored closed/revoked preference
appears unavailable and can be explicitly cleared or replaced. Historical grants
and record visibility are preserved independently of active creation eligibility.

## State, concurrency and recovery

Each opening fetches current context and captures its version. Eligible choices
use the self-service endpoint rather than the admin directory or grant editor.
Search/count/page and off-page selected captions share the same permitted source
population. Pending responses are aborted and tagged to the current selection,
query, page and refresh. Choice-load failures disable Apply and offer an explicit
discard/reload action. Authentication/authorization denial clears editing controls
and prevents a delayed successful label response from restoring stale metadata.

A successful preference change refreshes only its summary label. A tenant/user-
scoped BroadcastChannel notifies matching tabs on the same origin; window focus
and visibility refresh provide a fallback. Other users and tenant hosts do not
share a channel. No office metadata, session or credentials are broadcast.

An open selector draft is not replaced by that notification. A stale Apply returns
409, preserves its chosen office, disables another save and offers **Discard choice
and reload**. No save is retried automatically. Business forms keep their captured
ID/version through `useCreationOfficeSnapshot`; changing the preference in another
tab cannot silently reroute them. A stale new-record save returns 409 with its
original draft intact. Reopening the form captures the new context.

## API changes

- `GET /api/workspace/offices` accepts optional `selected` and returns an additive
  `selected` caption from the same active eligible population, independently of
  search/page. Existing bounded paging/sort/search and fresh authority remain.
  Foreign, closed or unauthorized selections resolve to null. Target-user and
  authority overrides remain invalid.
- `GET /api/workspace/office` adds `creationOfficeId`, the caller's own stored
  preference, while `creationOffice` remains the eligible active caption or null.
  This distinguishes a closed stored choice from a genuinely empty preference,
  permitting explicit clearing without displaying ineligible names.
- `PATCH /api/workspace/office` retains the existing optimistic version, tenant
  security lock, fresh active-office validation and mandatory SQL audit. It can
  change only the caller's preference, never office/company grants.

The protected layout requires an authenticated user ID before loading the fresh
account or constructing identity-scoped controls. No JWT role, selected office,
company placement or browser filter authorizes business work.

## Verification

Verified locally on 2026-10-27:

- 54 integration checks passed with no skips: seven self-workspace API cases,
  22 membership/preference checks and 25 native office-record checks. Cases
  include exact/company/descendant eligibility, bounded search/page/selected
  captions, closed/foreign choices, optimistic conflicts, explicit clearing,
  current revocation, audit integrity and unchanged grants/profiles/workplaces.
- Six real-sign-in Chrome flows passed. They cover keyboard opening/cancellation,
  dirty discard, paging, excluded offices, background-tab label synchronization,
  mobile footer controls, unchanged saved CRM offices/Read after switching or
  clearing, concurrent picker edits, a stale actual enquiry form, fresh creation,
  unassigned/no-profile users, closed preferences and platform-console exclusion.
  Injected lookup failure recovers through explicit reload. A held successful
  summary response cannot restore labels/controls after account revocation.
- Desktop/mobile screenshots were inspected. No viewport overflow occurred and
  both footer actions were asserted inside the mobile viewport.
- The disposable 129-migration rehearsal, rollback/preservation checks and all
  18 Inventory native checks passed. Production build, TypeScript, changed-file
  ESLint and whitespace checks passed. No skips count as passes.

Run `npm.cmd run test:workspace-office-ui`, or build then run
`npm.cmd run test:workspace-office-ui:browser`. They use only a guarded disposable
local database and synthetic sign-ins. Evidence is retained under ignored
`tmp/industry-release/phase2d8c-*.log`, the migration-run log and
`test-results/local-access` paths.

## Next bounded work

Verify the combined onboarding, memberships, workspace preferences and dated
workplaces across multiple teams/offices and custom profiles. Review the complete
R10 release inventory before external collaborator identities (phase 3) and hosted
staging/recovery gates. No hosted release is authorized by this local milestone.
