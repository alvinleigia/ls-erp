# R10 phase 2D7B: composed audit report review

Implemented locally on `staging`. No schema migration, hosted database change,
push or deployment is included. Saved event rows and credentials are not rewritten.

## Closed event registry

`platform/audit/registry.ts` defines the composed report's event families, action
requirements, module dependencies and security/shared/source/composed boundary.
A more specific prefix overrides a general prefix even when its requirement is
unavailable. For example, disabled Sales Documents cannot fall back to `crm.`,
and `crm.team.` remains security history even when CRM is disabled.

Unregistered event families are hidden for every role, including Tenant Admin.
The stored evidence remains available for administrator maintenance; registering
a future family requires defining its audience and native source/privacy boundary.
Do not restore a generic administrator fallback or infer access from URL labels.

| Event family | Report audience and boundary |
| --- | --- |
| Access, team, company/office, workspace, invitation, module, tenant/organization | Tenant administrator security review; native tenant/administrative RLS still applies |
| Business settings, tax, branding, terminology | Corresponding shared configuration Read; no office grant is implied |
| Inventory product/category/supplier changes | Matching Inventory resource Read and activation; new catalogue evidence is shared, old stock evidence retains native office metadata |
| Inventory stock and purchases | Inventory Product/Purchase Read plus native office RLS; stock events are now included for authorized non-admin reviewers |
| Service/category changes | Corresponding shared reference Read and activation |
| Service eligibility | Existing administrator-only composed review; Services and full audit scope |
| Shift templates and leave configuration | Matching module/resource Read; deliberately shared configuration |
| Schedules, recurring plans, daily roster | Matching module/resource Read plus the source family's native office/history policy |
| Saved appointments/orders/invoices | Appointments Read and activation plus saved-office audit RLS |
| Booking coupon configuration | Coupon Read and Appointments activation; does not delegate customer/booking Read |
| CRM, Real Estate, quotations, sales orders and receivables | Existing administrator-only composed audience, dependency checks and native source/sharing/office restrictions; non-admin users retain scoped record timelines |
| Catalog/reservations | Catalog/source requirements and existing conservative scope bounds; reservations additionally require full audit scope and sales-order source Read |
| Leave requests | Existing administrator/full-audit approval requirement plus native private leave history |

The registry gates event families; it does not replace source RLS or grant a
profile action. Raw report queries run as the same non-owner tenant application
role. Restrictive office, sharing, leave, workplace, schedule, plan, daily roster,
booking and stock audit policies continue to intersect the permitted event set.
Unknown/missing office metadata cannot become a broad source-history fallback.
Real Estate catalog snapshots with add-on markers in before **or** after are
hidden when that add-on is disabled.

## List and detail consistency

Both entrypoints obtain a shared lock on the Tenant row before resolving current
account status, profiles and Audit Read. Security administration uses the matching
exclusive row lock. The transaction uses Read Committed so a reader waiting for
an administrator sees the committed change. It does not acquire the scheduling
advisory lock, avoiding an opposing lock order with native operational writers.

Counts and paged headers use **one SQL statement snapshot**, preserving their
agreement even when another module appends history without that advisory lock.
The query uses bound parameters and closed column/direction choices. Search is
literal substring matching; exact entity/actor/request filters only narrow the
same permitted source population. Pagination has a deterministic ID tie-breaker.
A page beyond the end still returns the correct total and an empty item list.

Lists select bounded header fields only, not metadata/before/after snapshots.
Detail uses the same family/tenant/native scope, then applies nested credential
redaction and recorded-change formatting. A denied, unknown or newly inaccessible
entry returns the same 404. Actor joins are explicitly tenant-bound.

Dates mean event creation, using the tenant's calendar and an exclusive next-day
end. Responses include tenant date/time display context. Audit and coupon screens
share `lib/report-dates.ts`, including when the browser uses another zone. Lists
clear old headers/counts/context/details on refresh or error; detail reload/focus
checks discard old snapshots before fetching again.

There is no audit export endpoint or export grant. Unknown list keys such as
`format=csv`, `fields=before` or `officeId` return 400; filters cannot request
unbounded snapshots. A future export must add an explicit action and reuse this
same scope, redaction, paging/batch limits and date basis.

## Verification

- `npm.cmd run test:audit-reports`: native multi-office report checks, established
  audit/redaction/scale regressions and access-policy checks, in disposable Docker.
- `npm.cmd run test:coupon-report`: guards the report date-context refactor.
- After a production build, `npm.cmd run test:audit-reports:browser`: real isolated
  tenant sign-in, source filtering, tenant date formatting, mobile detail,
  revoked-office detail reload, empty view and shared-history recovery.
- Never use a client's login, hosted seed/reset scripts or production credentials.

The integration fixtures cover East/West/both/no-office reviewers, stock,
bookings, schedules, plans and daily roster; source/module/action revocation;
security and unknown families; overlapping prefixes; all exact filters/search,
SQL-like input, stable paging, closed history, tenant dates, redaction and a
reader genuinely queued behind an administrator's tenant row lock. Existing
10,000-row tests assert a bounded query count and retained chronological/source
indexes. Inspect browser screenshots before claiming visual verification.

Verified locally on 2026-10-27: all 23 audit/access checks, nine coupon report
regressions and one real-sign-in Chrome flow passed, with no skipped checks
counted as passing. The 10,000-row audit fixture used eight statements and five
summary rows without fetching snapshots. All 129 migrations and the 18 Inventory
native/preservation checks passed in the disposable harness. Production build,
TypeScript, changed-file ESLint and whitespace checks passed. Desktop, mobile
detail and revoked-office empty screenshots were inspected. Logs remain under
`tmp/industry-release`; browser images remain under `test-results/local-access`.

## Remaining release gates

This completes the bounded composed audit report slice. Phase 2D7C now consolidates the cross-module executable ownership contracts and
records the workspace readiness review in `RESOURCE_OWNERSHIP_R10.md`; its simple
audit families consume that same registration. Membership/provisioning/workspace
UI and the hosted release gates remain pending. The matrix in
`RESOURCE_BOUNDARIES_R10.md` records the current source inventory. Neither report work nor a directory grant releases office UI
or external collaborator accounts automatically. The R10 migrations/runtime still
require the full staged release and client-data recovery checks before hosting.
