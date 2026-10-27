# R10 phase 4C2b: dashboard attribution and matching records

Sales filters on Dashboard reuse the shared identity/origin contract. They apply
to CRM and document widgets and the sales columns of the optional project table.
Appointments, stock, workforce and project-directory totals retain their own
scope and are explicitly described separately. Generic CRM works without Real
Estate. No stored data, grants, ownership or saved attribution is migrated.

## Meaning and drill-downs

- User type describes the current enquiry/opportunity salesperson, the canonical
  opportunity owner for documents, and the actual assigned account for activities.
  It does not classify the payment/completion operator or infer the introducing
  partner. A partner-introduced sale may be handled by an internal user.
- Partner and supervisor-at-introduction filters use immutable source evidence.
  Current supervisor, rename, archive and assignment never rewrite that evidence.
  Null means no recorded introducing partner, not proven internal origin.
- Enquiries/quotations use their creation period. Won/lost opportunities use their
  closing period; converted enquiries are a creation cohort with a readable linked
  opportunity. Open pipeline/work are current. Completed work uses its saved
  completion date and credits its assigned account, not the operator clicking
  Complete. Date boundaries use the tenant calendar and time zone.
- Payment plans use only the latest quotation revision. Document totals are
  all-time; upcoming instalments run from today through the next 30 days, with
  undated instalments separate. Planned values are not receipts or balances.
  Currencies remain separate and no exchange conversion is inferred.

Count links and section actions open `/dashboard/sales-records` with the same
filter selection and explicit calendar dates. Counts, paging and rows come from
the same query sets as their widgets. Individual records still enforce their own
detail Read. Drill-down values and dates describe the selected metric, including
closing/completion dates and neutral captions for unavailable source owners.

## Access and reusable sets

`modules/crm/dashboard-sets.ts` and
`modules/sales-documents/dashboard-sets.ts` define canonical SQL populations.
Summary aggregates, previews, paged records and attribution choices reuse them;
there are no unbounded application-side ID lists or copied financial attribution.
The existing ORM project-sales adapter uses the same shared identity/origin
predicates, while project-directory access stays independent.

`application/dashboard/sales-service.ts` refreshes dashboard authority and module
flags inside a serializable read transaction and binds the database actor. Module
activation, source Read, native tenant/office privacy, record limits and explicit
sharing remain mandatory. Selectors return only minimal source-backed names/IDs,
including historical plan-only sources. Search, count, page and selected-ID lookup
share the same population; unused/private/foreign directory records are excluded.

Financial/document Read remains independent of opportunity Read. Unfiltered
document widgets remain available without source Read, with private owner/origin
data redacted. An origin filter additionally needs the readable source. Dependent
document/activity widgets are then omitted with an explanation when source Read
is absent; they never display unfiltered figures under a filtered heading.
Unavailable drill-downs and choices reject access. A share supplies neither a
missing action nor source permission. None/module/account/office revocation is
checked on fresh requests. Source filtering does not replace native RLS.

Filters and the new paged view abort superseded responses and hide old values
while loading/denied. Known filters and date windows validate centrally; malformed
or contradictory selections fail rather than silently widening the query. The
HTTP adapters preserve normal 400/403 handling. Shared dashboard kinds live in
`types/dashboard.ts`; modules do not import application implementations.

## Local checks and release boundary

`npm.cmd run test:partner-dashboard` uses the disposable synthetic PostgreSQL
database. `npm.cmd run test:partner-dashboard:browser` additionally runs real
Chrome after a local build. Historical office/booking/daily compatibility fixture
paths stay disabled. Hosted sessions and client credentials are not used.

Verified locally on 2026-10-27:

- All **93 service/native checks pass together**, with zero skips. Nine new
  dashboard cases cover identity/origin partitions, every count-to-row/page
  mapping, plan-only choices, latest revision accounting, independent document
  Read, source redaction, Restricted/Own/office limits, current module/account
  revocation, saved evidence, foreign IDs and optional project sales counts.
  The nine dashboard cases pass again after the final date/choice-query changes.
- **12 distinct real-Chrome flows pass across the combined and focused runs**:
  nine financial/activity/sales regressions and three new dashboard flows. New
  flows check exact-filter links, HTTP 400/403 handling, archived choices,
  dependent-widget omission, stale-value clearing and desktop/mobile layout.
  A nonzero Services KPI and all operational visibility/KPIs remain unchanged
  under sales filtering. The final three dashboard flows pass together.
- Desktop/mobile overview, filter and record captures were inspected. Tables
  scroll within cards; the final filter and pager remain usable at 390px.
- All **132 migration rehearsals** and **18 native stock checks** pass. No new
  migration/schema change. Production build, TypeScript, lint and whitespace pass.

Initial fixture/selector failures were corrected before counting passes: composite
quotation identity, actual revision editing, shared trigger text, awaited navigation
and a valid Read/action profile. Runtime permissions were not weakened.
Ignored evidence: `tmp/industry-release/phase4c2b-rehearsal.log`,
`phase4c2b-api.log`, `phase4c2b-dashboard-final.log`, `phase4c2b-build-final.log`,
`phase4c2b-browser.log`, `phase4c2b-browser-dashboard-final.log` and lint/TypeScript
logs. Screenshots are under `test-results/local-access`.

The wider historical `tests/crm-extensions.test.cjs` architecture scan currently
has 20 passes and three pre-existing failures in unchanged files: inventory stock command text
contains an order reference that its old assertion forbids; platform audit imports
the application date helper; and inventory office-choice routes violate that
scan's transport-only assertion. This phase corrects its own shared-type import
and leaves those separate inventory/audit findings explicit. They require cleanup
before calling the whole architecture baseline clean or starting release acceptance.
Their files and the scan itself match the preceding commit exactly after newline
normalization; hashes are saved in `phase4c2b-architecture-baseline.json`, and the
scan result in `phase4c2b-architecture.log`.

Hosted backup/restore rehearsal, copied-data effective-access comparison and
separate staging/production release gates remain. Current-supervisor portfolio
reporting is distinct from saved supervision. This slice is local on `staging`;
nothing is pushed or deployed and client records remain unchanged.
