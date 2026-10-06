# Module dashboard summaries

The business dashboard uses its existing period selector, ERP sections and surfaces,
and Recharts charts. Sales widgets live in `components/dashboard/sales-widgets.tsx`;
the server aggregate is `platform/dashboard/sales-summary.ts`.

## Definitions

| Section | Measure | Basis |
| --- | --- | --- |
| CRM | New enquiries / status chart | Enquiries created in the selected period; current status |
| CRM | Enquiry conversion | Those enquiries with an accessible linked opportunity / period enquiries |
| CRM | Open opportunities / stage chart / values | Current active pipeline, stage and contact; independent of period |
| CRM | Won / lost / win rate | Closed in period; won / (won + lost) |
| Activities | Completed calls / connected / activities | Completed in the selected period, using completion date |
| Activities | Type chart | Top eight recorded custom/base types, retaining saved type names |
| Activities | Overdue / next follow-ups | Current open or in-progress work; timed activities use their scheduled instant |
| Real Estate | Projects / subprojects | Active, accessible projects; subprojects require an active parent |
| Real Estate | Project sales preview | First six projects alphabetically; period enquiries and current open opportunities, including their subproject links |
| Sales Documents | Count / value / recent documents | Quotations created in period, each counted once with its latest value |
| Payment Plans | Documents / undated instalments | All accessible quotations' current revisions |
| Payment Plans | Upcoming instalments / value / preview | Today through the next 29 business dates; earliest six rows |

Money is grouped by currency, never added across currencies. Quoted and scheduled
amounts are proposals, not collected revenue or outstanding balances. Alternative
quotations are separate documents; obsolete revisions are excluded. Rates with no
denominator display an em dash.

Period boundaries use the tenant's calendar dates and time zone, including
daylight-saving transitions; they do not depend on the server's local date.

Site visits use the tenant's configured activity types. Ordinary meetings are not
silently reclassified as site visits. Historical activities without a custom type
remain under their base type (for example, Meeting).

## Access and queries

Every section requires its module and dependencies to be allowed and enabled.
CRM aggregates require `reports.read` plus the respective resource's read permission.
Project and quotation previews require their resource read permission. Payment Plans
additionally requires its module flag and quotation access.

Sales and activity record scopes reuse the CRM policy helpers. Project membership
uses the same helper as the project list. Payment plan SQL applies the same own,
managed-team and all-record opportunity scopes, under tenant RLS. Denied sections
are null and issue no section queries. Module changes refresh the dashboard.

Counts, sums and groupings run in the database. Record previews have a six-row limit;
chart groupings have an eight-row limit. View links open the full module lists.
No schema changes or migration is required.

## Verification

`tests/dashboard.integration.test.cjs` covers nonzero KPIs, period exclusions, currency
separation, revisions, missing dates, tenant isolation, own-record access and disabled
modules. `tests/core-access.integration.test.cjs` checks current permissions.
`tests/local-access/dashboard-modules.spec.ts` exercises real local APIs, custom
site visits, quotation schedules, module switches and desktop/mobile layouts.
