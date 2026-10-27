# R10 phase 4C1: activity attribution and performance

This local slice extends the phase 4B source/identity filters to Activity overview,
its workload and follow-up tables, My Work drill-downs and activity CSV exports.
It is generic CRM functionality and works with Real Estate disabled. No schema
change, access backfill or hosted database operation is required.

## What the filters mean

- **Assigned user type** distinguishes internal accounts from named external
  collaborator accounts. It describes the activity's current assignee, not its
  creator, the operator who completed it, or the partner who introduced its sale.
- **Partner introduction**, **Introducing collaborator** and **Supervisor at
  introduction** use the immutable evidence on the linked enquiry/opportunity.
  They do not infer origin from assignment, teams or current supervision.
- **No recorded introducing partner** includes readable unattributed sales
  sources and contact-only activities. Null evidence does not prove internal
  origin. A contradictory partner/supervisor selection is rejected.

Current open/overdue/due-today work is independent of the completion period.
Completed work uses the saved completion date within the tenant's calendar time
zone and remains credited to the current assigned user. The interface states
this basis explicitly; this is not an employee-action audit. Call outcomes,
type breakdowns and paged user totals follow the same filtered task set. Named
logins of one collaborator remain distinct workload users; no membership join
duplicates the underlying tasks.

Follow-up gaps remain readable open opportunities with no directly linked open
activity, across all activity types/dates. Identity filters here describe the
opportunity owner. The caption preserves that distinction. Open overdue work
still prevents a gap; archived pipeline/stage/customer records remain excluded.

## Access and reusable implementation

`platform/collaborators/report-validation.ts`, `report-scope.ts` and
`report-controls.tsx` provide the common contract for activity and sales reports.
The source filters narrow existing access and grant no directory permission.

`modules/crm/work-scope.ts` owns the existing activity ORM adapter and its SQL
Read projection. Both preserve Own, Related, Managed teams, All, None and explicit
sharing within native tenant, office and Restricted/source RLS. Existing service,
sales and dashboard callers now import this single ORM adapter.

`workAttributionWhere` requires enquiry and opportunity Read only when an origin
filter is applied. A readable activity with an unreadable parent can still be
read normally with its parent redacted; it cannot reveal that parent's partner
through a filter. Source choices also require both source Read actions and report
Read, and use the same readable current/completed task and follow-up-gap sets.
Only minimal source-backed identity/name choices are returned. Search, count,
paging and selected-ID resolution share those predicates; private, unused and
foreign partner directory entries are not exposed. Archived source evidence is
retained, and missing/unnamed supervisors use neutral fallback labels.

Overview drill-down links carry the attribution, team, assignee, type, state and
completion-period selection into My Work. Its origin filters remain explicit
report context with a Clear origin filters control. My Work does not substitute
a report choice population for its different operational list population. Invalid
URL attribution is rejected visibly instead of silently dropping the selection.
Superseded fetches cannot restore old rows; current permission errors clear data.

Activity CSV uses the identical list filters and ordering across all matching
pages. It requires activities Read **and Export**, intersects their record limits,
and retains native RLS and source checks. It rejects selections above 2,000 rows
before returning partial data, and uses shared spreadsheet-cell escaping. Export
does not expose private source evidence or confer report/directory permissions.

## Verification and release boundary

Use `npm.cmd run test:partner-activity` for the isolated Docker migration/service
suite, or `npm.cmd run test:partner-activity:browser` after a local build for real
Chrome flows. These use synthetic local identities only; historical office,
booking and daily compatibility fixtures remain disabled.

Verified locally on 2026-10-27:

- All **76 service/native regression checks** pass together with zero skips,
  including eight new activity cases, SQL/ORM parity for all supported scopes,
  read-vs-export action/record bounds, source privacy, revocation, foreign IDs,
  archived evidence, filtered paging and CSV escaping/2,000-row rejection.
- All **six real-Chrome flows** pass together: three new activity flows and three
  phase 4B controls/sales-report regressions. The actual CSV download, carried
  filters, hidden-source behavior, permission loss and archived-source selectors
  were checked. Real Estate is disabled in these generic CRM fixtures.
- Desktop and 390px mobile overview/filter/drill-down captures were inspected.
  The last filter remains reachable; the workload table scrolls within its card.
- All **132 migration rehearsals** and **18 native stock checks** pass. No new
  migration is introduced. The production build, TypeScript and changed-source
  lint pass. An initial test-only service import failure was corrected before
  the final full run; runtime access rules were not weakened.

Ignored evidence: `tmp/industry-release/phase4c1-api.log`,
`ls-erp-sales-orders-33a80415d87f.log`, `phase4c1-final-api.log`,
`phase4c1-final-build.log`, `phase4c1-browser.log` and `phase4c1-lint.log`.
Screenshots are under `test-results/local-access`. Nothing pushed or deployed;
pilot data and hosted sessions are unchanged.

Phase 4C2a adds [receivable attribution reporting](PARTNER_FINANCIAL_R10.md);
phase 4C2b dashboard attribution remains. Existing financial/dashboard totals were
unchanged in phase 4C1.
Current-supervisor portfolio reporting remains separate from saved supervision.
Hosted staging recovery, copied-data rehearsal, effective-access comparisons and
separate production release authorization remain required.
