# R10 phase 2D8A: tenant-admin office membership editor

Implemented locally on `staging`. No schema migration, grant backfill, hosted
write, push or deployment is included. Native R10 ownership and release/recovery
gates remain prerequisites before exposing these controls to clients.

## Use and boundaries

Tenant administrators open **Office access** from a business user's detail page
or the Users row menu. Active Admin, Manager and Staff accounts can be edited.
Inactive business accounts show retained grants read-only; customer accounts have
no membership editor action. The backend always checks current status and role.

- Specific offices grant only the selected office, including retained closed
  history. Captions identify company, office, code and closed state.
- Company grants cover that company's current and future offices. Each grant
  has its own explicit **Include subsidiary companies** switch, initially off.
  Multiple grants combine; hierarchy changes are evaluated against current data.
- Creation office is optional and must be active, with an active owning company,
  and covered by the proposed grants. It can be cleared explicitly. There is no
  implicit fallback or automatic office assignment.
- Tenant administrators retain oversight of every office. Office grants cannot
  restrict that role. Manager/Staff labels do not add eligible offices.
- Membership grants do not grant profile actions, record sharing, employee
  workplaces, team management or leave approval authority. Saved record offices
  and existing staff assignments are unchanged.

The editor uses the existing versioned membership API. One Save replaces the
policy and grants with the same mandatory transactional audit. Cancel and dirty
cancellation leave the saved state unchanged. A 409 retains the complete draft,
disables further saves and offers **Discard draft and reload**. It never silently
rebases or overwrites another tab. Failed validation preserves the draft; a 403
clears its controls and choices, requiring an explicit reload of current access.

## Draft choice endpoint

`POST /api/access/users/:id/offices/creation-choices` is read-only despite using
POST: the bounded draft grant arrays belong in the body, not a URL. It uses the
ordinary tenant-authenticated API wrapper, fresh Tenant Admin authority, tenant
security lock and existing membership validation. It never creates a policy,
writes grants, changes versions, selects a preference or records a domain change.

The strict body accepts only `officeIds` (max 200), `companies` (max 100, unique
IDs and explicit Boolean subsidiary flags), `selected`, `q` (max 160), `page`
(1..100000) and `pageSize` (1..100). Foreign targets/grants and unknown keys fail
closed. SQL parameters bind all inputs. The same permitted draft population feeds
search, count, page and selected-label resolution; the selected record is resolved
independently of search/page without leaving that population. Closed office or
company IDs can remain historical grants but never appear as creation choices.

The browser debounces/aborts choice requests, tags responses to the current draft,
search and page, retains saved captions, and displays explicit paging controls.
Directory lookups use the existing admin-only company/office endpoints rather
than delegating booking or staff-directory permissions. The editor does not load
every directory row or borrow the acting administrator's creation choices.

## Verification

Verified locally on 2026-10-27:

- 30 membership/creation-choice integration checks passed with a non-bypass
  runtime role. Eight new checks cover draft-only lookup scope, descendants,
  hierarchy/future offices, bounded search/page/selected resolution, closed
  captions, foreign/malformed input, fresh authorization and optimistic conflicts.
  Existing staff workplaces, manager links and profile assignments are seeded
  and included in unchanged-state comparisons.
- Three real-sign-in Chrome flows passed: the editor's exact/company grants,
  cancellation, explicit subsidiary coverage, off-page selection, stale-save
  preservation/reload, closed-history clearing and list/detail entry points;
  admin revocation clears controls without saving; existing HTTP membership
  and self-preference isolation remain intact. No hosted login is used.
- Desktop/mobile screenshots were inspected, and both mobile footer actions are
  checked within the viewport. Browser testing found and fixed a picker-opening
  page reset; changing search resets paging, reopening the same search does not.
- The disposable 129-migration rehearsal, rollback/preservation checks and all
  18 Inventory native checks passed. Production build, TypeScript, changed-file
  ESLint and Git whitespace checks passed. No skips count as passes.

Run `npm.cmd run test:office-membership-ui` or, after a build,
`npm.cmd run test:office-membership-ui:browser`. Evidence remains in ignored
`tmp/industry-release/phase2d8a-*.log` and `test-results/local-access` files.

## Next bounded work

Phase 2D8B adds initial office access to direct user creation/invitations, using
the existing backend `officeAccess` contract. Phase 2D8C adds the self-service
creation-office preference selector. Neither is implied by this editor, and
neither may widen record Read or replace employee workplace placement.
