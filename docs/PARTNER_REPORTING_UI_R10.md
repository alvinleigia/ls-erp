# R10 phase 4B: introduction controls and sales reporting

Local implementation on `staging` only. Nothing is pushed, deployed or run against
hosted databases. This uses the [phase 4A source contract](PARTNER_ATTRIBUTION_R10.md)
without a new migration, authorization resource, dependency or industry requirement.

## Recording an introduction

A Tenant Admin creating an enquiry or direct opportunity opens **Introducing
collaborator**, chooses an active partner, and saves the record. The choice is
optional and separate from contact/account referrals, lead source and salesperson.
An external login records its own collaborator automatically and does not load
the private admin directory. Other internal users cannot claim an arbitrary partner.

Saved details display the partner name and code captured at introduction. They
have no general Edit action. Conversion shows the original enquiry's introduction
read-only before save and inherits it exactly, including an unattributed source.
Ordinary reassignment, directory changes, archive and restore retain that evidence.

A failed or stale archived-partner selection preserves the draft and selected
label. The user can explicitly clear or change it. Selection is sent only during
new source creation; ordinary edits cannot silently resubmit/rewrite the origin.
The shared module provider supplies a fresh tenant-admin display hint. The server
and native source guards remain authoritative, including after authority changes.

## Using Sales reports

Open **CRM > Sales reports**. Existing scope, team, source, date, industry-context
and salesperson filters retain their meaning. The new filters only narrow that
readable population:

- **Salesperson type:** Internal and external (default), Internal users, or
  External collaborators. This classifies the current sales-record owner using
  the immutable account identity, independently of the introducing partner.
  Internal is not a claim about HR employment.
- **Partner introduction:** All sales origins (default), Partner introduced, or
  No recorded introducing partner. Choosing the last clears partner/supervisor
  selections explicitly. Null attribution is not evidence of internal origin.
- **Introducing collaborator:** a particular partner represented in accessible
  sales. Multiple logins for the same collaborator do not create extra partners.
- **Supervisor at introduction:** the internal identity saved with introduction,
  even if today's directory supervisor differs. The display name resolves from
  that saved user's current name; an existing unnamed user and a missing user
  display as Unnamed supervisor and Former supervisor respectively.

Lead conversion can also group by introducing collaborator, saved supervisor or
salesperson type. Group links open matching paged drill-downs. Existing pipeline,
won/lost values remain separate by currency and preserve decimal precision.
Record tables and CSVs include introducing collaborator, partner code and saved
supervisor display. The assignment column is **Assigned user**, covering external
accounts as well as internal ones.

Filters select sales records. Overdue follow-ups remain linked work for those
selected records, including work assigned to someone else. They are not employee
activity-performance measures. Creation/closing date bases and current-pipeline
semantics remain unchanged. Company totals include internal and external handling
by default within the selected scope; filters do not create a second outcome.

## Privacy, counting and implementation

`sales-report-service.ts` keeps the existing scoped SQL populations for overview,
breakdowns, values, drill-downs and exports. One-to-one source/User joins add
snapshot labels and owner identity; no collaborator-login or supervisor-membership
join can multiply the outcomes. Conversion remains one opportunity per enquiry.
All user-supplied filters are schema-validated bound values. Contradictory
unattributed-plus-partner/supervisor requests fail validation.

`/api/crm/reports/sales/attribution-choices` requires the same report and source
Read actions. It projects only identity and name from readable period enquiries,
current pipeline and period won/lost records. Search, page, count and selected-ID
resolution share that population. Archived partners remain filterable through
source evidence; unreferenced/private/outside-office/foreign directory entries
cannot become choices. Labels use the latest visible source snapshot. This is
not a collaborator directory permission or a new privileged lookup.

`platform/collaborators/introduction-controls.tsx` and the shared evidence type
serve both editors. Existing forms, dirty-state handling, sections, errors and
office capture remain in use. Shared filter panels cap their height to the
available viewport space and keep the final controls reachable by scrolling. Report requests abort superseded responses and
hide old data while a different query/refresh is loading or denied. Exports use
the same filter query and the existing limits and spreadsheet-cell escaping.

## Local verification

- **68 distinct service/native tests passed** together, with no skips. Coverage
  includes six new reporting cases, ten existing sales-report cases, the phase 4A
  attribution/race suite and existing external lifecycle, office/source/financial
  ancestry and resource-contract checks. Final report cases were rerun after the
  assignment-header/unnamed-supervisor wording changes.
- **Six distinct Chrome flows passed** across the combined and focused runs:
  three existing partner login-management flows and three new generic CRM flows.
  New flows create enquiries/direct opportunities, convert original introductions,
  retain archived-selection drafts, sign in as an external user, filter/group/
  export reports as a manager without directory access, reset filters and reject
  current authority loss. Real Estate is disabled in their synthetic tenants.
- Desktop and 390px mobile source/report/filter screenshots were inspected.
  Mobile controls and tables stay within the document width. No hosted sessions
  or customer credentials are used by these tests.
- All **132 migrations** and the existing **18 native stock checks** passed the
  isolated rehearsal. No migration/schema changes in this phase. Build, TypeScript,
  changed-source ESLint and whitespace checks passed.

The older sales-report fixtures now grant office access through the ordinary
tenant-scoped membership service and explicitly place root fixture records.
All three historical office/booking/daily compatibility fixtures remain disabled
in this suite. Initial fixture setup and ambiguous browser selector failures were
corrected; they are not counted as passes and no runtime rule was weakened.

Ignored evidence under `tmp/industry-release`: `phase4b-retained.log`,
`ls-erp-sales-orders-408dd25515a2.log`, `phase4b-reports-final.log`,
`phase4b-build-verified.log` and `phase4b-browser-viewport.log`. Screenshots are under
`test-results/local-access`.

## Next and release boundary

Phase 4C1 implements [activity filters, drill-downs and exports](PARTNER_ACTIVITY_R10.md).
Phase 4C2a implements [receivable attribution reporting](PARTNER_FINANCIAL_R10.md);
phase 4C2b adds [dashboard contributions and matching rows](PARTNER_DASHBOARD_R10.md). Derive child
financial attribution through the canonical opportunity; do not introduce editable
copies or add enquiry and opportunity counts into one duplicated outcome total.
Current-supervisor portfolio reporting must stay distinct from saved supervision.
This phase does not change workforce/operational widgets or general dashboard totals.

Hosted staging still needs a fresh encrypted restore-tested backup, copied-data
migration rehearsal and pilot ID/owner/effective-access comparison. Production
requires a separately authorized release. Local verification does not replace
those recovery and hosted acceptance gates.
