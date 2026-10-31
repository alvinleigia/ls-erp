# Team performance

Sales reports has a **Team performance** tab for users whose Reports Read scope
includes other users. Select a reporting period and use Filters → Sales team to
compare every visible member together. There is no need to select a salesperson.

## Usage

- Summary compares enquiries, conversions, open/won/lost opportunities, overdue
  work, completed activities and calls. Pipeline values remain separate by currency.
- Compare → Enquiry statuses shows New, Contacted, Qualified and Lost, plus the
  separate converted count and weighted conversion percentage.
- Opportunities shows current pipeline, won/lost results and follow-up gaps.
- Activity statuses shows Open, In progress, Overdue, Due today, completions and
  cancelled activities created during the reporting period.
- Call outcomes compares Connected, No answer, Busy, Voicemail, Wrong number,
  Not interested and other/unrecorded outcomes.
- Click a nonzero count to see its matching records, then open an individual record.
- Click a numeric column header to sort. Search members narrows rows and totals.
  Totals cover the entire selection, including pages not currently displayed.
- Metric headings and CSV captions follow tenant terminology. Calculation details
  are available in the expandable guidance; mobile controls stack above the table
  and the member column remains visible during horizontal scrolling.
- Export CSV includes all metric groups and a final total row, with a 2,000-user
  bound. Narrow the selection when it exceeds that bound. Export permissions can
  be narrower than Read; the file uses its actual exportable source population.

## Meaning of the figures

Enquiries use their creation date in the tenant time zone and display their
current status. Converted means a linked opportunity is currently readable;
it overlaps the status counts. Conversion percentage is total converted divided
by total enquiries, not the average of staff percentages. No enquiries is shown
as a dash rather than a claimed conversion rate.

Won/lost opportunities use closing dates. Open pipeline, active workload, overdue
and due-today figures show current work across all creation dates. Activities
completed in the period use completedAt and are credited to their current assignee,
not the person who clicked Complete or the owner of their linked opportunity.
Cancelled work has no dedicated cancellation-date field; its column explicitly
uses the creation-period cohort. This is not a historical assignment snapshot or
a staff employment/productivity rating.

Team filtering follows the saved sales team on each enquiry/opportunity and the
parent of linked activities. Membership in multiple teams never duplicates records.
Contact-only work is included with all teams; it cannot be attributed to a selected
sales team. A parent-source filter applies to linked activities independently of
the parent's salesperson. Partner introduction remains separate from assignment.

## Access and implementation

The generic CRM implementation reuses the installed sales-report context and its
industry extension hooks. Real Estate project filters are supplied by application
composition, with no property-specific logic in the performance service. No schema,
data migration, module activation or access-profile changes are required.

Endpoints under `/api/crm/reports/sales/team` provide summary/member paging,
`/records` drill-down and `/export` CSV. A closed metric contract and allowlisted
sort columns generate bound SQL. One facts population supplies counts, details
and CSV; serializable transactions keep member pages and totals consistent.

Fresh Reports, Enquiries, Opportunities and Activities Read permissions remain
mandatory, as do tenant, source, sharing and office RLS. Filters only narrow access.
Selected teams reuse the existing managed-team report guard. CSV additionally
requires Reports and all three source Export actions, with Read intersecting Export
record limits. The SQL activity adapter now follows the bound operation action,
matching the existing ORM export adapter.

Zero-work roster rows require Team membership Read and its own team scope. The
UI states when that permission is unavailable and shows readable source owners
instead. Former/non-member owners with matching records remain in the report, so
their results do not disappear on membership changes. Account status and internal/
external classification are shown explicitly; no email directory is returned.

Browser requests clear previous figures while filters change and on denied/error
refreshes. Tables scroll within their own region on narrow screens. Production
write testing is prohibited; verification uses disposable local data and synthetic
staging data only.

## Repeatable verification

Build the app, then run `node scripts/test-sales-orders.cjs --team-performance --browser`.
The runner creates and removes its own localhost PostgreSQL fixture. Native tests
cover dates, every metric/drill-down, zero rows, former owners, stable paging,
weighted conversion, currencies, CSV, sharing, office/profile/export limits,
partner choices, terminology and a 1,000-enquiry selection. Browser tests cover
the report controls, actual CSV downloads, permission loss and mobile scrolling,
alongside existing partner sales/activity regressions.

Local verification (2026-10-31): all 34 native/unit checks and eight browser
scenarios pass. The final comparison flows were repeated after adding team-name
context. Optimized build, TypeScript, targeted lint and whitespace checks pass.
Desktop and mobile screenshots were inspected. Hosting verification targets
staging only; production promotion is a separate release.
