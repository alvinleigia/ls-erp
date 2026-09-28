# Phase 5 - Sales visibility and filtered exports

Implemented locally on 2026-09-28. No hosted deployment or business data changes.
This phase adds reporting to the shared CRM; Real Estate remains optional.

## Delivered

- CRM > Sales reports (`/crm/sales`), alongside the existing Activity overview.
- Lead counts and conversion grouped by source, salesperson or optional project.
- Current pipeline and won/lost deal counts and exact values by stage/currency.
- Overdue linked follow-ups and open opportunities without directly linked work.
- Clickable metric and breakdown counts, with matching paginated record lists.
- CSV downloads from those lists and existing enquiry/opportunity filters.
- Shared sections, dropdowns, display formats, error/loading states and pagination.
  Mobile summary cards use two columns; wide tables scroll inside their section.

## Reporting contract

All endpoints use current CRM membership, module access, tenant RLS and the
existing service transaction boundary. Staff can report only on their own leads
and opportunities. Admins/managers can choose personal or team scope, optionally
filtering a salesperson. Current ownership, source IDs and project links determine
attribution; this is not a historical ownership or stage-transition ledger.

The default period is the latest 30 business dates. Both endpoints are inclusive,
converted to a half-open timestamp range in the business time zone. Explicit
periods must contain both dates and span at most 366 days, including DST changes.

| Measure | Definition |
| --- | --- |
| Leads created | Accessible enquiries created in the selected period, all intake statuses. |
| Converted leads | Those same leads with a currently accessible linked opportunity, regardless of when conversion occurred. A lead is counted once. |
| Conversion percentage | Converted leads divided by leads created in the period; zero when the denominator is zero. Reassigned inaccessible opportunities do not disclose conversion to staff. |
| Current pipeline | Accessible opportunities currently in an OPEN stage, excluding archived pipelines, stages and contacts. Independent of the reporting period. |
| Won/lost | Currently WON/LOST opportunities with `closedAt` in the period. Reopening removes a deal from this result; closing again uses the new closing date. Archived configuration remains in historical totals. |
| Deal value | Decimal sum grouped by stage and currency. Currencies are never combined or converted. Deal value is not revenue received or a payment balance. |
| Overdue follow-ups | OPEN/IN_PROGRESS work linked directly to accessible leads/deals matching the sales filters, regardless of activity assignee. Timed work uses its start instant; all-day work uses its due date. The lead's creation date does not restrict current follow-ups. Contact-only work remains in Activity overview. |
| Deals without open work | Current-pipeline deals with no directly linked OPEN/IN_PROGRESS activity, regardless of assignee. Overdue work still provides coverage. |

Archived sources/projects and inactive former owners retain their historical
groups. Leads without a managed source share an explicitly labeled
"Unclassified / legacy source" group; original source text remains on records.
Leads without a project appear in "No project". Linked projects do not grant
broader project access. Disabling Real Estate hides project data and rejects
project filters/grouping without deleting the underlying associations.

## Downloads

Exports rerun authorization and filtering at download time, within a single
transaction. They include every matching page, ignoring the current page/size,
but **never more than 2,000 records**. Larger selections return a clear error
asking the user to narrow filters; they are not silently truncated. Reports and
breakdowns remain server-paginated and can count datasets larger than that cap.

- Enquiries: ID, title, customer, salesperson, source, optional project/subproject,
  status, target close date and creation time.
- Opportunities: ID, title, customer, salesperson, source, optional project/
  subproject, pipeline, stage, outcome, deal value/currency, expected close,
  closing time and creation time.
- Report details: ID, title, record type, customer, assigned staff, source,
  optional project/subproject, status/outcome, deal value/currency, creation/
  closing times and due date. Non-applicable cells are empty.

CSV uses UTF-8 with a BOM, quoted cells, escaped quotes and CRLF record endings.
Formula-like text (including whitespace-prefixed formulas and international
phone numbers) is prefixed with an apostrophe for spreadsheet safety. Timestamps
are explicitly UTC; date-only values stay ISO dates. Notes, requirements,
referral identities and payment/document information are not exported.
Downloads are no-store attachments and retain the API request ID.

This is an operational reporting/export release. Saved report definitions,
scheduled exports, arbitrary custom report builders and asynchronous bulk jobs
remain future work. No schema migration is introduced in Phase 5; the earlier
CRM and Real Estate migrations are prerequisites.

## Regression fixes

- Duplicate-key handling now reads the PostgreSQL adapter's nested constraint
  fields as well as Prisma's legacy `meta.target`. Simultaneous conversion can
  retry and return the existing accessible opportunity instead of reporting an
  unrelated contact duplicate.
- Reselecting the current opportunity pipeline preserves its selected stage.
  Stale pipeline responses cannot overwrite a newer selection.
- The nested enquiry-filter browser test explicitly closes the filter popover
  before using pagination, avoiding a race with the inner selector's dismissal.

## Verification

Use a disposable local `ls_salon_crm_test` database and the documented guarded
browser fixture. Never run the preparation script against a hosted database.

```powershell
npm.cmd run test:crm
npm.cmd run test:crm:sales:integration
node --require ./tests/register.cjs --test --test-concurrency=1 tests/crm.integration.test.cjs tests/real-estate.integration.test.cjs
npx.cmd tsc --noEmit
npm.cmd run build
```

Sales integration coverage includes all roles, tenant isolation, module-off
behavior, reassigned conversion privacy, source/project/owner filters, grouped
and paginated reconciliation, inclusive dates/DST, exact mixed-currency values,
archived configuration, current-work coverage, CSV escaping and export bounds.
The test uses the production tenant adapter with a non-bypass application role.

Local verification results: 19 unit checks and 9 sales integration scenarios
passed; the full CRM/property integration run passed 77 with 3 fixture-gated
skips. Browser regression covered 24 scenarios: 22 initially passed; after the
filter-test and pipeline-selection fixes, all 10 affected scenarios passed on
rerun (including the report tests). TypeScript, targeted ESLint and production
build passed. The final production render was checked on desktop and mobile
in both light and dark themes, with screenshots inspected and no page overflow.
Local evidence is in `test-results/phase5-final-visuals/` (ignored test output).
An existing intermittent activity-plan concurrency test failed in an earlier
combined run, then passed in isolation and the full sequential regression; it
should continue to be monitored during the pilot.

Browser coverage exercises actual local API-backed data, report and list
downloads, filter changes, error recovery, pipeline re-selection and responsive
layouts. Hosted verification remains pending.

## Next phase

Following the user's clarification, Phase 6 is internal regression using our
existing CRM Test leads, not a client pilot or legacy import. See
[Phase 6 readiness](CRM_SALES_PHASE_6.md) for existing-record checks, deployment
gates and the remaining sequence. Payments, bookings and documentation remain
deferred.
