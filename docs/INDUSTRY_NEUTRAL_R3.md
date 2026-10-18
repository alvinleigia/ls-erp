# R3 common configuration

Date: 2026-10-17. Local work only; R5 remains the production release gate.

## R3(a): custom-field registration and context

Implemented locally:

- `application/custom-fields/resources.ts` composes the existing enquiry,
  opportunity and project descriptors. Its HTTP adapter retains the current URLs;
  the old application/CRM adapter is removed, with no compatibility wrapper.
- The shared service checks each descriptor's module and dependencies through
  `moduleEnabled`. It no longer contains an unconditional CRM activation rule,
  sales-team queries or project-specific scope rules. All currently registered
  resources still require CRM directly or through their module dependency.
- CRM owns team validation: tenant scope, staff membership for form requests,
  active teams for new definitions and retained archived teams for existing fields.
  Real Estate owns its business-wide project field rule and rejects team context
  on both configuration and form requests.
- Scope and resource must agree. Registration rejects duplicate resource keys,
  unsafe value-table identifiers and conflicting context policies for shared scopes.
- CRM supplies batched, explicitly tenant-scoped record/team lookups for enquiry
  and opportunity exports. The shared exporter no longer derives record-table
  names from value-table strings or branches on project scope. Transferred team
  values remain stored but are omitted from exports where they no longer apply.
- `components/erp/custom-field-control.tsx` owns the existing typed input control,
  used directly by field configuration, record inputs and filters. Presentation
  and archived option behaviour are unchanged. The sales conversion hook remains
  with CRM; it is not presented as a general-purpose industry hook.

Preserved: definition/option/value IDs, field codes, SQL tables and indexes, scopes,
team links, requiredSince and SALES conversion cohorts, existing custom-field
configuration permissions, transactional audits, import mappings and immutable
quotation snapshots. No schema change or data rewrite is needed for this batch.
The existing scope enum and salesTeamId storage/API are intentional stable
contracts, not new arbitrary tenant-defined resources or generic EAV storage.

## Verification

- 63 architecture and database integration checks passed, with no failures/skips:
  custom fields, sales teams, CRM boundaries, imports and quotations.
- Six local browser sales workflows passed against the production build, including
  conversion, follow-up, reports, quotation snapshots, won close and spam reasons.
- Production build/TypeScript passed (134 pages), along with targeted lint and
  whitespace checks. No new visual-layout acceptance claim is made for this batch.
- Local scale fixtures retained indexed/bounded reads: 10,000 custom-field values
  used 13 statements for a five-row page; 10,000 sales rows used 12 statements for
  a five-row team page. These are disposable local results, not hosted benchmarks.
- New fixture setup errors were corrected to respect existing team name keys,
  qualification-first workflows and module allowance constraints before the final
  passing runs. Application safeguards were retained.

No hosted database, client record or deployment was changed. No migration, push
or deployment was performed. The disposable test database was stopped afterward.

## R3(b), batch 1: terminology foundation

Implemented locally: code-owned module label catalogs, application composition,
shared normalization/resolution/validation, tenant override persistence and the
administrator form at **Settings > Terminology**. Changes remain local until the
consumer coverage and R5 release gates are complete. This batch provides the
configuration foundation; existing screens/documents are not yet switched to
tenant terminology.

The initial supported keys are the following singular/plural pairs (18 labels):

| Prefix | Defaults |
| --- | --- |
| `crm.enquiry` | Enquiry / Enquiries |
| `crm.opportunity` | Opportunity / Opportunities |
| `crm.contact` | Contact / Contacts |
| `crm.account` | Business account / Business accounts |
| `crm.activity` | Activity / Activities |
| `realEstate.project` | Project / Projects |
| `realEstate.subproject` | Subproject / Subprojects |
| `salesDocuments.quotation` | Quotation / Quotations |
| `paymentPlans.paymentPlan` | Payment plan / Payment plans |

Append `.singular` or `.plural` to each prefix. This is an allowlist of record
names, not a claim that every field, status, technical string or module name can
be edited. Field-level terminology coverage must be explicitly added with its
consumer/collision rules; custom-field labels remain in their existing editor.

- Resolution: explicit tenant override, installed module default, core default.
  Today's names remain defaults. Business names/domains never select an industry.
- Labels are normalized for Unicode compatibility/spacing, bounded to 60
  characters and reject markup, control characters and spreadsheet formula
  prefixes. Effective singular names and plural names must be distinct across
  record types, including disabled modules, so reactivation remains safe.
  Existing fixed control labels are reserved by application composition.
- Active business users may resolve active-module labels. Only an active tenant
  administrator may edit; managers with custom roles do not gain that authority.
  Customer/platform users are rejected. Module dependencies are checked before
  returning labels or accepting edits. Disabled-module overrides stay stored.
- Reads use one repeatable tenant snapshot and a bounded number of queries. There
  is no process-global tenant cache or per-record lookup. Consumer integration
  must reuse the returned map once per request/page context.
- All writes lock the tenant row shared with module changes, use ReadCommitted
  to recheck authorization after any wait, and compare the supplied global version.
  Concurrent/stale saves return 409. Each changed batch and its strict before/after
  audit commit together; failures roll back both. No-op saves add no revision/audit.
- Clearing an override restores its default. Resetting does not erase revision
  or audit history. The settings form uses shared sections, inputs and Save/Cancel
  placement, preserves drafts on errors and offers refresh for stale configuration.

Migration `20261017120000_tenant_terminology` adds `TenantTerminology` with a
tenant/key primary key and `TenantTerminologyRevision` with a tenant primary key.
Both tables have forced tenant RLS and foreign keys. No existing rows, custom
fields, import mappings or quotation snapshots are rewritten. Existing tenants
need no backfill: no revision row means version 0 and missing overrides mean
defaults. The migration was applied only to the disposable local database;
production application and rehearsal remain R5 work. Explicit test-only tenant
reset cleanup includes the two new tables.

Verification: 41 unit/architecture/integration checks and three local browser
workflows passed (44 total, no failures/skips). Production build/TypeScript passed
(135 pages), as did targeted lint and whitespace checks. Desktop and mobile
settings screenshots were inspected; inputs/actions stayed within the viewport.
The queue test confirms role or module changes made during a tenant-lock wait
are observed before writing. Initial fixture enum/type errors were corrected
before these final runs. No hosted query, client data change, push or deployment.

Repeatable entry points: `npm.cmd run test:terminology`,
`npm.cmd run test:terminology:integration` with the disposable local database,
and `terminology.spec.ts` under the local browser configuration.

## R3(b), batch 2: shared loading and initial screen consumers

Implemented locally: a tenant/user-scoped terminology provider in the protected
layout and a pure contextual resolver. The API returns a separate replacement
map containing explicit tenant overrides or installed module defaults, so core
defaults do not overwrite contextual wording such as "People" or "New lead".
Interpolation is literal, including dollar signs and braces in configured labels.

The provider fetches once per mounted business workspace, then refreshes after
terminology/module changes or window focus. Consumers reuse context without
per-row queries or navigation fetches. Superseded requests are aborted and their
responses ignored. Failures revert to contextual defaults. Tenant/user/role
changes remount the provider; platform/customer layouts do not fetch terminology.

Current coverage is explicit, not every text occurrence:

- Sidebar record links/groups for enquiries, opportunities, contacts, accounts,
  activities, quotations and projects. Module names and permission keys stay fixed.
- Shared contact/account/enquiry lists: titles, name columns, create actions,
  enquiry import entry and filter labels. Embedded lists reuse the same controls.
- Contact/account/enquiry/opportunity editors: page headings, Back/Save/create/
  conversion links, details sections, related record selectors and applicable tabs.
- Opportunity list/board headings, record columns, creation, counts and sorting.
- Project/subproject lists: titles, record columns, creation, filter accessible
  names and empty-state wording.

Shared sections and edit summaries accept a stable section key independently of
the title. These editors retain their open section and unsaved values when a
label refreshes. User-entered names/titles, routes, field IDs, form payloads,
permissions, enum values and saved document snapshots are never rewritten.
Additional fixed navigation/column names are reserved against label collisions.
No new migration is needed.

Verification: 35 unit/architecture/database integration checks and 13 distinct
local browser checks passed (48 total): six existing sales flows, three terminology
administration flows and four consumer flows. The consumer checks confirm labels
on lists/forms/navigation, unchanged entered record text, isolated tenant defaults,
no terminology refetch on client navigation, refresh/reset/error recovery without
losing drafts, and summary actions opening the correct edit section. An initial
test selector used "Name" instead of "Full name"; after correcting it all four
consumer tests passed. Production build/TypeScript (135 pages), targeted lint and
whitespace checks passed. Desktop list and mobile form screenshots were inspected;
controls stayed within the viewport. No hosted queries, client data changes,
schema migration, commit, push or deployment. Disposable test database stopped.

Evidence: `tmp/r3b-consumer-{checks,build,lint,browser}.log`, lint/browser recheck
logs, and `tests/local-access/terminology-consumers.spec.ts`. Logs and screenshots
remain ignored local artifacts. This checkpoint completes only the coverage above,
not all terminology consumers.

## R3(b), batch 3: activity, property and document controls

Date: 2026-10-18. Implemented locally using the existing protected-layout provider;
no new label endpoint, query, schema change or storage rewrite.

- Activity list, schedule/editor, shared scheduling fields/type selector, calendar,
  overview headings/cards and history section controls resolve record labels.
  Completion/cancellation buttons and success notifications use the same resolver.
  Activity types, outcomes, stored history messages and user titles remain intact.
- Project details/create/edit/archive actions use the project or subproject key
  appropriate to the record. Subproject and activity tabs, project sales actions,
  related-opportunity tables, shared property selectors/filters and the CRM property
  summary reuse the provider. Parent/child links and selection IDs are unchanged.
- Quotation lists/template headings, creation actions, title inputs, version
  navigation and detail sections resolve quotation terminology. Payment tabs,
  schedule summaries and schedule edit sections resolve payment-plan terminology.
  Stable section keys connect summary edit actions to the correct accordion even
  after terminology changes with a draft open.
- Configuration changes affect surrounding controls only. Stored document titles,
  additional-detail labels, linked-context labels/values, calculations, instalment
  milestone names and historical PDFs are not rewritten. Payment-module checks and
  historical read-only behaviour remain in place. Module setting names stay fixed
  so messages such as "Enable Payment Plans" still point to the actual setting.
- Fixed tab/control names introduced by these consumer contexts are reserved to
  prevent ambiguous names, including Team, Sales, Type and Pricing and charges.

This is primary control coverage, not a claim that all explanatory/error text,
configuration pages, reports, import/export headers or document rendering now use
tenant terminology. Existing contextual wording remains the fallback everywhere.

Verification: 43 unit/architecture/database checks and 13 distinct local browser
checks passed (56 total), covering existing sales workflows, the previous consumer
flows and three new module flows. New checks confirm parent/child link IDs,
property preselection, stable activity save payloads, preserved editor drafts,
unchanged saved quotation snapshots and disabled editing when Payment Plans is off.
An initial assertion expected the Edit button to be hidden; the existing disabled
button behaviour was confirmed and the assertion corrected. All three module
checks passed on rerun. Production build/TypeScript (135 pages), targeted lint and
whitespace checks passed. Desktop/mobile payment drawer screenshots were inspected
with animations disabled; controls and footer stayed within the viewport.

Evidence: `tmp/r3b3-checks.log`, `tmp/r3b3-build.log`, targeted lint logs,
`tmp/r3b3-browser.log`, `tmp/r3b3-browser-recheck.log` and
`tests/local-access/terminology-modules.spec.ts`. No hosted query, client data change,
migration, commit, push or deployment. Disposable local database stopped afterward.

## R3(b), batch 4: configuration and related-record terminology

Date: 2026-10-18. Implemented locally using the existing shared provider.

- Configuration cards resolve activity names, lead-source names and record wording.
  The default descriptor export remains available to routing/access composition;
  resolving display labels never changes its URLs or permission requirements.
- Activity type, plan and follow-up rule controls use configured terminology.
  Suggested-next-step summary/edit sections share a fixed section key, so a label
  refresh retains the selected accordion and unsaved values. Plan application keeps
  its reviewed schedule, selected record IDs and request key during a label refresh.
- Custom-field scopes display configured enquiry/opportunity/project names in
  filters, creation and summaries while retaining ENQUIRY/OPPORTUNITY/SALES/PROJECT
  values. Sales-team workflow choices retain DIRECT/ENQUIRY_FIRST values. Source,
  lost-reason and pipeline explanatory copy uses the same record labels.
- Contact/account relationship controls, confirmations and interaction headings use
  shared labels. Unlinking still removes only the relationship. Stored record/type/
  plan/step names, instructions, field codes, permissions and histories stay intact.
- Existing contextual defaults remain the fallback. Configuration preset content,
  fixed control names and server validation messages remain canonical. This is not
  a claim that every explanatory string, report, export or PDF is terminology-aware.

Verification: 33 unit/architecture/database checks and nine distinct local browser
checks passed (42 total). Five new configuration flows cover stable save codes,
stored names, draft retention, matching edit sections, reviewed plan application,
relationship unlinking and configuration navigation; four existing consumer flows
cover defaults, tenant isolation, fetch reuse and refresh recovery. Two initially
ambiguous assertions were narrowed to read-only detail values before all tests
passed. Production build/TypeScript (135 pages), targeted lint and whitespace checks
passed. Desktop configuration and mobile type-editor screenshots were inspected;
controls and the fixed Save/Cancel footer remain within the viewport.

Evidence: `tmp/r3b4-checks.log`, `tmp/r3b4-unit-final.log`,
`tmp/r3b4-build-complete.log`, `tmp/r3b4-lint-complete.log`,
`tmp/r3b4-browser-complete.log` and
`tests/local-access/terminology-configuration.spec.ts`.
No new query, migration, hosted access, client data change, commit, push or deployment.
The disposable local database was stopped afterward.

## R3(b), batch 5: report and dashboard terminology

Date: 2026-10-18. Implemented locally through the existing shared provider.

- Sales report metric cards, breakdown selectors, record headings/columns and
  explanatory copy resolve configured enquiry/opportunity/contact/activity names.
  Filter keys, metric keys, calculations, URLs, pagination and export requests stay
  unchanged. Label refresh preserves selected grouping, bucket and record page.
- Report extensions supply optional terminology keys with their canonical column
  and grouping labels. The Real Estate add-on owns its project/subproject keys;
  core CRM has no industry-name mapping. Summary metadata exposes display fields
  only, never SQL descriptors. No label query or per-row resolution query was added.
- Only the explicit __none__ grouping bucket uses a configurable empty label.
  Real records whose names happen to be "No project" remain unchanged. Selected
  empty-bucket captions refresh without resetting the report selection.
- CRM, Real Estate and Sales Documents dashboard cards, chart tooltips, links,
  table headings and descriptive copy share terminology. The generic count chart
  accepts a display noun with its existing "Records" fallback. Module names,
  statuses, saved record names and custom activity-type names remain intact.
- Activity overview filter/period/help copy uses the same provider. Existing
  contextual defaults remain the fallback. Import/export headers, newly generated
  document labels and remaining server/error copy are outside this batch. Saved
  quotation snapshots/PDFs are not rewritten.

Verification: 43 unit/architecture/database checks and nine distinct local browser
checks passed (52 total), including six existing sales workflows. New browser
checks verify unchanged totals/snapshots, chart tooltip labels, stable record links,
page/group/bucket retention with no report or dashboard refetch, reset/default
behaviour and disabled-module gating. An initial test read page-two rows before
loading completed; it now waits for the row before comparing preserved state.
Production build/TypeScript (135 pages), targeted lint and whitespace checks passed.
Desktop report/dashboard and mobile report/payment-section screenshots inspected;
tables scroll within their containers and controls remain inside the viewport.

Evidence: `tmp/r3b5-checks.log`, `tmp/r3b5-build-final.log`,
`tmp/r3b5-lint{,-browser,-final}.log`, `tmp/r3b5-browser.log`,
`tmp/r3b5-browser-final.log`, `tests/report-labels.test.cjs`, and
`tests/local-access/terminology-reports.spec.ts`.
No migration, hosted query, client-data change, commit, push or deployment.
The disposable local database was stopped after verification.

## R3(b), batch 6 - CSV templates, mapping and export terminology (2026-10-18)

- Import page headings, instructions, field choices, defaults and completion text
  reuse the shared terminology provider. The original uploaded headings remain
  visible. Label refresh preserves file, mapping, defaults, batch identity and
  processing state without refetching the import.
- Base and extension import fields carry optional code-owned terminology metadata.
  Renamed template headings include stable field keys, for example
  "Prospect title [title]". The mapper resolves explicit keys before aliases, so a
  downloaded template or correction sheet still works after a terminology reset.
  Canonical headings/aliases still map; custom-field scope/code headings are intact.
  Template filenames, field keys, column order and empty-template behaviour stay fixed.
- Correction downloads retain original column headings, values, row numbers and
  error details. Duplicate detection, row validation, resumability, existing-record
  protection, permission checks and module gates are unchanged. Stored validation
  messages and generated record titles are not rewritten by terminology changes.
- Enquiry/opportunity, sales report and project CSV exports resolve code-owned
  contact/project/subproject/value labels. Add-ons own their display metadata;
  custom-field headers, saved names, record kinds, monetary values and all other
  cell contents remain unchanged. Export filenames and limits stay unchanged.
- An authorized transaction reads tenant overrides/module flags with two shared
  presentation queries per template/upload/export, never per row. Normal lists and
  row validation/commit receive no additional terminology query or global cache.
  Application composition supplies the installed catalog to CRM. Fixed import and
  export control names are reserved against conflicting record-name configuration.

Verification: 51 unit/architecture/database checks and two local browser flows
passed (53 total). Coverage includes reset/reupload, canonical and renamed headers,
correction-only downloads, duplicate skips, unchanged export cell values, tenant
isolation, module/permission gates, and a live terminology change retaining mapping
and defaults with zero import refetches. The existing end-to-end correction/reupload
flow also passed. Production build/TypeScript (135 pages), targeted lint and
whitespace checks passed. Desktop/mobile mapping screenshots were inspected; controls
fit and the mobile page has no horizontal overflow.

Evidence: `tmp/r3b6-checks-final.log`, `tmp/r3b6-build-final.log`,
`tmp/r3b6-lint-final.log`, `tmp/r3b6-browser.log`,
`tests/import-labels.test.cjs`, `tests/crm-import.integration.test.cjs`, and
`tests/local-access/terminology-import.spec.ts`.
No migration, hosted query, client-data change, commit, push or deployment.
The disposable local database was stopped after verification.

## R3(b), batch 7 - immutable quotation document labels (2026-10-18)

- New quotation defaults resolve the configured quotation name once. A saved or
  manually edited title, template contents, line items, terms and custom detail
  labels are never renamed by a terminology refresh.
- Each newly saved revision captures resolved customer/opportunity headings,
  payment schedule heading and document notice in its existing JSON snapshot.
  The application injects the shared tenant terminology reader; Sales Documents
  remains independent of industry catalogs. The Real Estate context provider
  receives the same resolver and freezes its own project/subproject labels.
- Saved summary sections and PDF generation read the revision's labels, not live
  tenant terminology. Existing revisions without captured labels retain the exact
  original fixed wording. No snapshot backfill, migration or history rewrite.
  A deliberate new revision uses current terminology and preserves content/totals.
- One terminology snapshot is loaded per default/save operation (two scoped
  queries), never per line/context row. Revision reads, list reads and PDF rendering
  add no terminology query. Disabled modules cannot contribute labels to new
  snapshots; saved payment labels remain visible with their saved schedules.
- PDF section headings wrap within their shaded header for long configured names.
  Payment instructions retain the explicit non-receipt notice. Fixed document
  headings cannot be reused as configurable record names. Template-application
  help refers to linked records without assuming every business uses property.

Verification: 43 unit/architecture/calculation/database checks and seven distinct
local browser flows passed (50 total), including the six existing sales workflows.
Checks cover immutable prior revisions, unchanged calculations/content, new-title
defaults, preserved draft titles after label refresh, permissions/tenant isolation,
module-off behavior, forged snapshot-label rejection and document-label collisions.
Production build/TypeScript (135 pages), targeted lint and whitespace checks passed.
Saved-label desktop/mobile screenshots inspected. Three test PDFs (six pages) were
rendered with PyMuPDF and visually inspected: original snapshot wording, configured
labels and a 60-character heading. Text extraction confirms the expected labels;
totals, terms, continuation headings and footers remain legible without overlap.

Evidence: `tmp/r3b7-checks-final.log`, `tmp/r3b7-build-final.log`,
`tmp/r3b7-lint{,-final,-browser}.log`, `tmp/r3b7-browser.log`,
`tmp/r3b7-browser-final.log`, `tmp/pdfs/r3b7/`,
`tests/quotation-labels.test.cjs`, `tests/quotations.integration.test.cjs`, and
`tests/local-access/terminology-documents.spec.ts`.
Initial verification fixes were confined to the test harness: synchronous schema
rejection assertion, valid PDF sample number format, and renamed title locator.
No hosted query, client-data change, commit, push or deployment. Disposable DB
stopped after verification.

## R3(b), batch 8 - contextual copy and coverage audit (2026-10-18)

- Contact/account archive confirmations, access guidance, status labels and save
  notices now use the existing terminology provider. Account name fields, enquiry
  conversion/custom-field help, follow-up/reminder copy and activity calendar/list
  guidance use explicit semantic keys with the original contextual defaults.
- Real Estate owns configurable project/subproject wording in code uniqueness,
  staff access, archive/restore, sales and property-interest guidance. Quotation
  list and template-application help use current record names. Fixed module names
  such as Payment Plans remain discoverable in activation instructions.
- Import metadata separates the custom field's literal name from its scope.
  ENQUIRY scope captions follow the configured singular name; SALES remains the
  shared sales scope. User names containing {label} or $& remain literal. Field
  IDs, enquiry.code template headers, mapping/defaults, correction sheets, saved
  field values and duplicate handling are unchanged. No additional query.
- All screen changes reuse the layout provider. No label dependency was added to
  record-loading effects. Changing labels does not reload drafts, submit archive
  actions, reset mapping selections or rewrite user content.

Coverage review (cumulative batches 1-8):

| Surface | Current coverage / boundary |
| --- | --- |
| Navigation, record lists/forms and accessible controls | The 18 allowlisted singular/plural names; stable URLs, section keys, permission keys and field identities. |
| Configuration, reports and dashboard | Record-name controls and measures reuse the shared resolver; module/configuration identifiers and configured choice names remain fixed or user-owned. |
| Import/export | Live mapping/default captions and generated headers; custom codes and uploaded correction headers remain stable. |
| Saved quotations/PDFs | New revisions capture labels once; prior revisions, amounts, notes and user titles are immutable. |
| Current helper/confirmation copy | Contact/account, enquiry, activity, project and quotation guidance expanded in this batch. This is not a claim that every literal has been converted. |
| Historical and technical text | Saved notes, audit messages, correction errors, API keys, enums and bank account labels are not globally renamed. Enquiry/opportunity activity-history headings describe the audit timeline, not a scheduled CRM activity type. |

The audit found remaining R3 work: server-side record validation errors and their
client fallback diagnostics still use canonical names. A few loading/link and
code-generated work-history captions also remain. Add explicit structured error
presentation where appropriate; never search-and-replace server messages or
rewrite persisted import/audit text. R3 is not marked fully complete yet.
The property hint in WorkList and linked-project quotation composition remain
R4 ownership work, even where their current names already resolve correctly.

Verification: 34 unit/database checks and nine distinct local browser flows passed
(43 total). Production build/TypeScript (135 pages), targeted lint and whitespace
checks passed. Desktop/mobile import mapping and the mobile archive confirmation
were visually inspected. Tests verify literal custom field names, stable CSV
mapping and saved values, zero import refetches on label changes, no archive write
before confirmation, preserved drafts/reset defaults and immutable quotations.
An older quotation browser locator was corrected to expect the frozen summary
heading introduced in batch 7; the editor still uses current terminology. The
corrected flow passed separately. No application workaround was added.

Evidence: tmp/r3b8-checks.log, tmp/r3b8-build.log, tmp/r3b8-lint.log,
tmp/r3b8-lint-final.log, tmp/r3b8-browser.log (eight passes plus stale locator),
tmp/r3b8-browser-final.log (corrected quotation flow passed),
tests/import-labels.test.cjs and tests/local-access/terminology-{copy,import,modules}.spec.ts.
No migration, hosted query, client-data change, commit, push or deployment.
The disposable local database was stopped after verification.

## R3(b), batch 9 - validation presentation and final coverage (2026-10-18)

- Code-owned TermText metadata presents configurable record names in 104 service
  error sites and six validation refinements. Canonical exception messages,
  HTTP status, validation field paths and permission checks remain unchanged.
  Literal user content is never searched or replaced.
- Error presentation runs after rollback, rechecks active tenant membership and
  reads one tenant-scoped terminology snapshot. Annotated failures use three
  bounded reads; successful requests and unannotated errors add no label reads.
  Presentation failures fall back to the original error.
- Client fallback diagnostics use a stable reader of the shared provider's latest
  labels. Loading effects do not rerun on label changes or reset unsaved drafts.
  Loading/link captions and generated work-history captions now resolve record
  names. Live follow-up explanations carry optional presentation metadata;
  permission warnings clear any earlier explanation metadata.
- Stored audit messages, import correction errors, CSV field identities, user
  content and saved quotation snapshots remain unchanged. Fixed module names,
  technical diagnostics, bank account labels and generic audit-history headings
  are intentionally not renamed. This completes the scoped R3 implementation for
  the 18 allowlisted record-name keys, not arbitrary text customization.

Verification: 161 unit/database checks passed; four historical migration checks
remain deferred to R5. After the follow-up permission fix, 75 checks from that
same set passed again (not counted twice). All 24 distinct terminology browser
checks passed: the initial run had 23 passes and one ambiguous alert locator;
the corrected locator and all three error flows passed on rerun. The expected
application message was already correct. Build/TypeScript (135 pages), lint and
whitespace checks passed. The mobile conflict screenshot was visually inspected;
the renamed warning, unsaved draft and save/cancel controls remain readable.

Evidence: tmp/r3b9-checks.log, tmp/r3b9-checks-final.log,
tmp/r3b9-build-final.log, tmp/r3b9-lint.log, tmp/r3b9-lint-final.log,
tmp/r3b9-browser.log, tmp/r3b9-browser-final.log,
tests/terminology-errors.test.cjs and tests/local-access/terminology-errors.spec.ts.
No schema migration, hosted query, client-data change, commit, push or deployment.
The disposable local database was stopped after verification.

## Next

R4: isolate remaining Real Estate view composition, including the property hint
in WorkList and linked-project quotation composition, and prepare the migration
package. Reuse the shared components and preserve access, drafts and saved data.
R5 retains protected backup/restore, older-schema migration rehearsal,
reconciliation and deployment.
