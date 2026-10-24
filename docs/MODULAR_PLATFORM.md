## R9 - Shared teams and ERP access foundation (local verification)

Business teams are now independent of CRM, with separate sales/project scope
controls, project-team assignments and a team filter in Activity overview.
The migration preserves team identifiers, membership, existing sales scopes and
forced RLS. Existing project authority is the default. Operational modules retain
their explicit native policies; team membership never grants leave approval.
Production is unchanged. See [R9 access model](ACCESS_MODEL_R9.md) for the resource
matrix, migration and verification status.

## R7.5 - Collection follow-ups verified on staging (2026-10-23)

Receivables now link to existing Activities for owners, dates, calls, outcomes,
notes and chained follow-ups. Pending work appears beside the balance. Financial
access remains separate from activity assignment; settlement stops new collection
work without deleting history. Migration 106 preserved 22 checked tables. Staging
ed30240 passed 59 integration, 41 architecture/access and three hosted workflows;
desktop/mobile screens and runtime RLS/audits were verified. Production is unchanged.
See [collection rules and verification](COLLECTION_FOLLOW_UPS_R7.md).

## R7.4 - Receivables overview verified on staging (2026-10-23)

Sales Orders now includes a permission-gated Receivables overview with search,
balance/currency filters, database pagination and separate currency ageing totals.
Current ownership/team scope applies to rows, counts and summaries. No migration
or existing balance changes were required. Staging f727d8c passed 55 integration
and 41 architecture/access checks plus hosted overview/payment workflows; desktop
and mobile screenshots were inspected. Production remains unchanged. See
[overview rules and verification](RECEIVABLES_OVERVIEW_R7.md).

## R7.3 - Order receivables verified on staging (2026-10-23)

Optional receivables now support frozen schedules, partial payments, corrections
and full-refund records on confirmed Sales Orders. Known extra charges are
included; pending charges block opening. Paid orders cannot be cancelled until
payments are resolved. Migration 105 preserved 15 existing tables. The isolated
suite passed 52 integration and 40 architecture/access checks; all three hosted
QA workflows passed. Runtime RLS, audits and desktop/mobile views were verified.
Production is unchanged. See [scope and verification](RECEIVABLES_R7.md).

## R7.2 - Unit reservations verified on staging (2026-10-23)

Staging commit 1b1f195 is deployed and verified: expiring unique-unit holds, allocation on
confirmed orders, reasoned release and atomic order-cancellation cleanup.
Catalog availability and editing respect reservations; existing records and
activation remain unchanged. Migration 104 preserves 13 existing tables; 42 integration,
40 architecture/access checks and both hosted browser workflows passed. Production
was not changed. See [scope and verification](UNIT_RESERVATIONS_R7.md).

## R7.1 - Hosted staging verified (2026-10-23)

Sales Orders commit 6a8424e is deployed on ls-erp-staging. Migration 103 preserves
existing data/configuration. Hosted QA tenant tests passed for create/confirm/
cancel, immutable revisions, duplicate prevention, separate manager permissions,
module activation, tenant isolation and desktop/mobile screens. Runtime RLS and
mandatory audit records were checked directly with the restricted staging role.
Production remains at c0905b4 / dpl_BVmvJ2iay6VneUXS1vjYerXuA3RC.
See [R7.1 evidence and repeatable hosted checks](SALES_ORDERS_R7.md).

## R7.1 - Shared Sales Orders (2026-10-22)

Implemented locally: draft creation from saved quotation revisions, immutable
commercial snapshots, explicit confirmation/cancellation, required cancellation
reasons and transactional history/audit. Sales Orders is an optional module with
Sales Documents/CRM dependencies and separate read/create/confirm/cancel access.
Current opportunity record scope applies; no existing tenant is auto-activated.
No stock reservation, payment collection or automatic opportunity closure occurs.

The additive migration and workflow are verified in a disposable local database;
local browser checks cover desktop/mobile and access restrictions. Hosted staging
rollout is the next checkpoint. Production remains at the R6 release below.
See [Sales Orders behavior, tests and rollout](SALES_ORDERS_R7.md).

## R6 - Production release and recovery close-out (2026-10-22)

Branding, quotation PDF archiving, admin UI fixes and database adapter fixes were
merged to main at c0905b4 and released on 2026-10-21 (Asia/Calcutta). Production
erp.ewissen.in served the verified deployment; both migrations applied (102 total)
with existing records preserved. Nine live read-only checks passed and desktop/
mobile branding screenshots were inspected. Earlier staging-only entries below
are historical checkpoints, not the current production release status.

The storage recovery companion is now implemented locally. Twelve tests pass;
a fresh database restore matched 108 tables and financial totals, and both current
logo files recovered with matching checksums. Matching restored database references
were verified. Production had no archived PDFs at capture time. See
[recovery scope and evidence](STORAGE_RECOVERY.md). No hosted writes or deployment
were performed during this close-out. R7.1 Sales Orders remains planned: see
[scope and delivery sequence](SALES_ORDERS_R7.md).

## R6 - Quotation PDF archive: implementation (2026-10-20)

Draft previews remain temporary; Issue & Download archives one immutable PDF per
quotation revision in private Supabase storage. Downloads authorize the tenant and
record before returning a short-lived link. Concurrent issuance, revision history,
access controls and storage failures are covered by 101 passing local checks.
Build, TypeScript and targeted lint passed. See [archive workflow](QUOTATION_ARCHIVE.md).
Production release remains separate from the staging rollout.

## R6 - Tenant branding: staging verified (2026-10-19)

Tenant-specific logo optimization, preview and storage; sidebar and immutable
document branding. See [setup and verification](TENANT_BRANDING.md). Staging upload,
replacement/removal, saved quotation logo retention, desktop/mobile UI and tenant
isolation passed at b0fa998. Production remains unchanged.

## R6 - Products and Units: implementation verified (2026-10-18)

Optional Sales Catalog with a shared product/unit model, Real Estate unit details,
project Units tab and quotation item snapshots. Tenant activation, role permissions,
RLS and audited concurrent saves apply. See [R6 implementation](PRODUCTS_UNITS_R6.md).
Released on 2026-10-18 at commit 144598ff5e4cd3565f98e9387c720cfc4c2f8abf.
The additive migration is applied (100 migrations total). A fresh encrypted backup
was restored and compared before release. Existing data and financial totals
matched across migration. Live read-only checks passed; Sales Catalog remains
unallowed/disabled for all tenants pending intentional activation.

## Industry-neutral R5: released and live tenant reads verified (2026-10-18)

Production release 740cfc527a47aae55b397c5572fde080500e42b5 is live on the verified
leiwissen/ls-erp project. Both planned migrations applied (97 to 99). A fresh
encrypted backup was restored in isolation and checked before migration; existing
data, financial totals, identities, permissions and relationships reconciled.
Runtime access was restored to its original role attributes. Existing Vercel
environment settings were retained and the local project link was corrected.

The tenant administrator subsequently signed in to the dedicated test browser.
Live verification passed: dashboard connection; eight CRM desktop/mobile checks;
13 project/enquiry/conversion-form/settings/list checks; and five disabled-module
API denials. Screenshots were inspected. No client record/configuration writes were
performed by these UI checks. Earlier runtime checks covered seven existing user
contexts with 42 successful reads and six expected platform-scope denials.

R5 is closed. The user chose to proceed without further client write-flow testing.
The conversion form was opened without saving; quotation/payment-plan create,
version and PDF behavior retain isolated-test evidence. No client pipeline setup
or synthetic client record creation is pending as a release requirement.

Private receipts and screenshots remain under ignored tmp/industry-release and
backups/r5/643fd6867e3b; no customer records or credentials are included here.
The earlier preparation entries below are historical, not pending release steps.

## Industry-neutral R5: recovery permissions verified (2026-10-18)

Selective recovery now preserves managed schemas/default ACLs and restores all
application object owners/grants. Non-superuser migration and rollback rehearsed:
ownership/ACLs match source metadata; all data/schema/history fingerprints match,
zero FK orphans. Six source event-trigger functions exercised without modification.
See docs/INDUSTRY_NEUTRAL_CUTOVER.md for the reviewed exclusions and execution gates.
Next: agreed maintenance window, final target check and fresh verified backup,
then the two migrations and matching deployment. No production changes or push.

## Industry-neutral R5: freeze and rollback rehearsed (2026-10-18)

Seven isolated freeze/drain/reopen tests passed using the source operator privilege
shape. Reapplied both release migrations on the protected client copy, then restored
the backup over it: all source data/history/schema/RLS fingerprints match, zero
foreign-key orphans. Local ownership/ACL differences remain explicit: production
recovery-permission review is next, before the agreed maintenance window and fresh
backup. Concrete procedure: docs/INDUSTRY_NEUTRAL_CUTOVER.md. No hosted writes,
role changes, session termination, commit, push, relink or deployment.

## Industry-neutral R5: populated queries and grant compatibility passed (2026-10-18)

Forty-one sales/document/dashboard/custom-field tests passed, including an indexed
10,000-value filter and paginated 1,007-row quotation list without revision loads.
Read-only runtime-role inventory confirmed no RLS bypass or table ownership.
Source default grants reproduced before migration correctly grant both new tables;
nine terminology tests pass. ICU provider/locale and 15 ordering/case samples match,
while ICU versions differ. Existing Vercel settings retained; no secrets guessed.
Next: controlled write-freeze/cutover preparation, then an agreed maintenance window
and fresh backup. No production writes, commit, push, relink or deployment.
See docs/INDUSTRY_NEUTRAL_R5.md for evidence and remaining recovery limitations.

## Industry-neutral R5: historical fixtures and local recovery verified (2026-10-18)

All 99 migrations replayed with pre-upgrade synthetic data; 98 integration tests
passed with no skips, closing all four deferred historical checks. User chose
project-local backup storage: encrypted artifacts retained under ignored backups/,
restricted ACLs applied, copied checksums and in-memory decryption verified.
Recovery remains tied to this Windows account/PC. Six production settings are
missing locally; no values changed. Broader performance/environment equivalence,
configuration recovery and cutover remain. No live writes, commit, push or deploy.
See docs/INDUSTRY_NEUTRAL_R5.md for evidence and storage limitations.

## Industry-neutral R5: runtime and workflow checks passed (2026-10-18)

Baseline/current services match in 84 existing-account read comparisons on the
protected client restore, including response hashes and query counts/plans.
Ninety module/access assertions pass with full data fingerprints unchanged.
Fresh production build/TypeScript and all 58 local browser workflows pass; five
representative screenshots inspected. No application code change was needed.
Historical fixtures, broader performance/source-environment equivalence and
independent recovery/cutover work remain. No live writes, commit, push or deploy.
See docs/INDUSTRY_NEUTRAL_R5.md for evidence and limitations.

## Industry-neutral R5: deployment identity verified (2026-10-18)

Fresh user-authorized CLI login accesses leiwissen/ls-erp. Vercel confirms
erp.ewissen.in points to READY production deployment dpl_FjvreJBMLNBi4gNJtywYeNcngpzd
at baseline commit 5f13238. The stale local .vercel link remains unchanged;
release must explicitly select the verified project. Runtime, performance and
recovery gates remain. No live writes, push or deployment. See
docs/INDUSTRY_NEUTRAL_R5.md for the sanitized verification receipt.

## Industry-neutral R5: restored-client upgrade verified (2026-10-18)

Twelve checksum differences traced to original LF files with final CRLF: exact
bytes match the preserved October 4 copies and database history; normalized SQL
matches baseline Git. Pinned and validated that encoding without editing SQL or
history. All 97 baseline migrations reconcile. Prisma deployed both pending
migrations on a protected client restore (97 to 99); complete existing data,
financial and schema/security comparison passed. Repeat deployment was a no-op.
Thirty non-bypass database isolation assertions passed, with probes rolled back
and full post-test capture unchanged. Six checker tests, lint and source checks
passed. Temporary databases removed; backup/evidence retained. Vercel CLI auth
returns 403; renewed sign-in requested. Application/runtime, performance and full
recovery/deployment gates remain; no live writes, commit, push or deployment.
See docs/INDUSTRY_NEUTRAL_R5.md for evidence and remaining work.

## Industry-neutral R5: protected application restore verified (2026-10-18)

Confirmed Ewissen's Supabase target; encrypted public/app backup and two isolated
PostgreSQL 17 restores verified all 104 table fingerprints and financial totals,
with zero FK orphans. Exact CHECK-expression regroupings were reviewed; source
locale and grants remain runtime/recovery gates. All 97 baseline migrations
replayed, but 12 hosted historical checksums remain unexplained and still block
release. No history override or release migration applied. Snapshot format 2
supports non-null unique identities and stable C ordering; five tests, targeted
lint and source verification passed. Temporary databases removed; protected
backup retained, with Windows-account-bound key and retention review documented.
See docs/INDUSTRY_NEUTRAL_R5.md for limits and remaining gates. No client writes,
commit, push or deployment. Next: history reconciliation and recovery/deployment
identity before migration/runtime cutover checks.

## Industry-neutral R4 complete locally: release preparation (2026-10-18)

Release manifest pins 99 migrations (97 unchanged from 5f13238, two pending),
Prisma schema and allowed table/index changes. Local-only reconciliation streams
per-tenant identity/content fingerprints, checks FK/schema/RLS/history integrity
and stored financial totals. Pending terminology migration is transactional, with
failure rollback verified. Five checker/fixture tests passed, no skips; source
verification and targeted lint/whitespace passed. No runtime/UI change this batch.
Representative fixture evidence is not a client-data restore or complete upgrade
test. See docs/INDUSTRY_NEUTRAL_RELEASE.md and docs/INDUSTRY_NEUTRAL_R4.md.
No hosted query, client-data change, commit, push or deployment. Local fixture
databases removed and container stopped. Next: R5 target inventory, protected
client backup/restore rehearsal, full release gates and controlled cutover.

## Industry-neutral R4, batch 4 provider audit (2026-10-18)

Audited preset/report/dashboard/import/document boundaries. Import project choices
now skip project queries without projects.read; new/changed project links enforce
that permission on the server. Revoked import mappings reject rows without orphan
contacts. Existing linked context, conversion preservation and document snapshots
retain their established semantics. Preset definitions moved into owning modules;
application composition preserves IDs, versions and item keys.
80 unit/database checks and four distinct browser flows passed; dashboard recheck
passed after waiting for its completed summary. Build/TypeScript (135 pages,
exit 0), targeted lint and whitespace passed. Corrected dashboard and mobile import
screenshots inspected. No schema change, hosted query, client-data change, commit,
push or deployment; disposable DB stopped. See R4 notes for evidence.
Next: R4 migration manifest/reconciliation package. Client restore/cutover is R5.

## Industry-neutral R4, batch 3 configuration/export composition (2026-10-18)

Custom-field scope labels and team-context capabilities now come from registered
resources. Shared configuration contains no Real Estate scope branch. The generic
CSV button requires explicit owning-screen permissions, including report/record
intersection. Existing field identities, values, validation and exports remain.
40 unit/database checks and 11 browser flows passed; production compilation,
TypeScript and 135 pages completed. Targeted lint/whitespace passed, and desktop
field/mobile configuration screenshots were reviewed. See R4 notes for the
PowerShell informational-stderr wrapper status and detailed evidence.
No schema change, hosted query, client-data change, commit, push or deployment.
Disposable DB stopped. Next: remaining provider audit and migration/reconciliation
package; protected production restore/cutover evidence stays in R5.

## Industry-neutral R4, batch 2 sales view composition (2026-10-18)

Enquiry/opportunity filters and exports share the installed extension's query
mapping. Application creation pages delegate URL defaults to Real Estate; shared
editors receive neutral references. Existing links and stored associations remain
unchanged. Inactive extensions hide fields/captions and omit live filter/payload
data. Module refreshes retain authorized drafts; failed/revoked access still hides
the view. Stable extension loaders prevent unrelated panel changes reloading forms.
53 unit/database checks and 24 distinct browser flows passed across final runs;
two historical migration checks remain for R5. An initial tenant-switch failure
passed in isolation and in a full access-suite recheck, with no auth code changes.
Build/TypeScript (135 pages), lint and whitespace passed; filter screenshots reviewed.
No schema migration, hosted query, client-data change, commit, push or deployment.
Disposable local DB stopped. Next: configuration/export presentation boundaries,
remaining provider audit and the R4 migration/reconciliation package.
See docs/INDUSTRY_NEUTRAL_R4.md for evidence and remaining scope.

## Industry-neutral R4, batch 1 view isolation (2026-10-18)

Real Estate now owns project activity query construction and site-visit guidance;
shared WorkList accepts neutral composition inputs and retains its common controls.
Quotation editing uses neutral linked-record and business/registration wording.
No schema, saved field, API URL or snapshot format changed. Historical documents
retain their context when the addon is disabled; new context remains module-gated.
54 unit/database checks and six distinct browser flows passed; two older-schema
migration checks remain for R5. Build/TypeScript (135 pages), lint and whitespace
passed. Mobile/desktop screenshots inspected; corrected existing WorkList display
punctuation and reran the affected build/browser checks. Local database stopped.
No hosted query, client-data change, commit, push or deployment.
R4 remains open: next is enquiry/opportunity view state and route composition,
then configuration/export boundaries and the migration/reconciliation package.
See docs/INDUSTRY_NEUTRAL_R4.md for evidence and remaining scope.

## Industry-neutral R3(b), batch 9 validation presentation (2026-10-18)

Scoped R3 configuration work is complete locally: explicit record-name error
metadata, tenant-scoped response presentation, stable async fallbacks and current
work-history/follow-up captions. Canonical errors, permissions, stored content,
CSV identities and saved quotation labels are preserved. Successful requests add
no terminology query; annotated failures use one bounded snapshot after rollback.
161 unit/database checks and 24 distinct browser flows passed. Four historical
migration checks remain for R5. Build/TypeScript (135 pages), lint and whitespace
passed; mobile draft/conflict controls inspected. No hosted query, client-data
change, commit, push or deployment. Disposable local database stopped.
Next: R4 Real Estate view composition and migration package; R5 protected release.
See docs/INDUSTRY_NEUTRAL_R3.md for scope boundaries and verification evidence.

## Industry-neutral R3(b), batch 8 contextual copy and audit (2026-10-18)

Expanded configurable names in archive confirmations, access/help text, activity
controls and Real Estate guidance. Custom import scope captions change without
altering user field names, CSV codes or mappings. Shared provider; no new query.
43 checks passed: 34 unit/integration and nine distinct local browser flows.
Build/TypeScript (135 pages), lint and whitespace checks passed. Desktop/mobile
import screens and mobile archive confirmation inspected. Corrected an older
quotation test locator to respect batch 7's immutable saved summary headings.
No hosted query, client-data change, commit, push or deployment. Local DB stopped.
R3 remains open: next is explicit validation/error presentation plus remaining
loading/link/work-history copy. R4 composition and R5 protected release follow.
See docs/INDUSTRY_NEUTRAL_R3.md for coverage boundaries and evidence.

## Industry-neutral R3(b), batch 7 quotation document labels (2026-10-18)

New quotation defaults and revisions capture configured document labels. Saved
summaries/PDFs use immutable snapshot labels; existing snapshots retain original
wording. Real Estate owns context labels. No historical rewrite or new migration.
50 checks passed (43 unit/architecture/calculation/integration, seven browser flows),
production build/TypeScript, lint and desktop/mobile review passed. Three PDFs/six
pages rendered and inspected, including a 60-character wrapped section heading.
No hosted query, client-data change, commit, push or deployment.
Next: R3(b) completion/remaining-copy audit, then R4 view composition and R5 release.
See docs/INDUSTRY_NEUTRAL_R3.md for evidence and scope.

## Industry-neutral R3(b), batch 6 CSV terminology (2026-10-18)

Implemented locally: CSV template/mapping UI and enquiry/opportunity/report/project
export labels resolve tenant terminology. Renamed template headings retain stable
field keys across resets. Original correction headers/cells, mappings, duplicate
handling, validation, permissions and saved record values remain intact. Two scoped
presentation reads per template/upload/export; no per-row label queries.
53 checks passed (51 unit/architecture/integration, two browser flows); production
build/TypeScript, targeted lint and desktop/mobile screenshot review passed.
No migration, hosted query, client-data change, commit, push or deployment.
Next: R3(b) batch 7 generated document labels and remaining contextual copy;
R4 view composition and R5 protected migration/release remain pending.
See docs/INDUSTRY_NEUTRAL_R3.md for details and evidence.

## Industry-neutral R3(b), batch 5 report/dashboard terminology (2026-10-18)

Implemented locally: sales report controls, grouping/column metadata and dashboard
cards/charts/tables reuse shared terminology. Real Estate supplies its own display
keys; core CRM remains industry-neutral. Labels do not change SQL, counts, selected
filters/pages, stored names, quotation snapshots, routes or module/access checks.
No extra label query or migration. Configured labels refresh without data refetch.
52 checks passed: 43 unit/architecture/integration and nine local browser flows.
Build/TypeScript (135 pages), lint and whitespace checks passed. Desktop/mobile
report and dashboard screenshots inspected. Initial pagination test wait corrected.
No hosted query, client-data change, commit, push or deployment. Local DB stopped.
Next: CSV template/mapping/export and newly generated document terminology.
R3(b) remains in progress; R4-R5 pending. See INDUSTRY_NEUTRAL_R3.md for evidence.

## Industry-neutral R3(b), batch 4 configuration terminology (2026-10-18)

Implemented locally: configuration cards, activity types/plans/rules, custom-field
scopes, sales-team workflows, source/pipeline/reason copy and related account and
interaction controls reuse the shared terminology provider. Stable section keys,
field/workflow codes, selected IDs and reviewed plan requests preserve drafts and
stored data during label changes. No additional query or migration.
42 checks passed: 33 unit/architecture/integration and nine local browser flows.
Build/TypeScript (135 pages), targeted lint and whitespace checks passed. Desktop
configuration and mobile type-editor screenshots inspected. Two test selectors
were narrowed to detail values to avoid matching navigation/hidden options.
No hosted query, client data change, commit, push or deployment. Local DB stopped.
Next: reports/dashboard terminology, remaining contextual copy, imports/exports
and newly generated documents. R3(b) remains in progress; R4-R5 remain pending.
See INDUSTRY_NEUTRAL_R3.md for explicit coverage and evidence.

## Industry-neutral R3(b), batch 3 module terminology controls (2026-10-18)

Implemented locally using the existing shared provider: primary activity controls,
project/subproject details and property selectors, quotation and payment-plan
controls. Stable section keys preserve drafts during terminology changes. Stored
titles, IDs, payloads, histories, quotation snapshots and PDFs remain unchanged.
56 checks passed: 43 unit/architecture/integration and 13 distinct browser checks.
Build/TypeScript (135 pages), targeted lint and whitespace passed. Desktop/mobile
payment drawers reviewed with animations disabled. A test assertion was corrected
to reflect the existing disabled Edit button when Payment Plans is off.
No migration, hosted query, client data change, commit, push or deployment.
Next: remaining related/configuration controls and copy, reporting/import/export
and newly generated document terminology. R3(b) remains in progress; R4-R5 pending.
See INDUSTRY_NEUTRAL_R3.md for explicit coverage and verification evidence.

## Industry-neutral R3(b), batch 2 shared terminology consumers (2026-10-17)

Implemented locally: tenant/user-scoped label loading, contextual resolution and
initial CRM/navigation consumers. Shared contact/account/enquiry lists, main CRM
editors, opportunity list/board and project/subproject lists use configured record
names. Stable section keys preserve open forms and drafts during label refresh.
Routes, permission keys, stored values and saved document snapshots stay intact.
48 checks passed: 35 unit/architecture/integration and 13 distinct browser checks.
Build/TypeScript (135 pages), targeted lint and whitespace passed. Desktop/mobile
consumer screenshots reviewed. Initial test selector corrected before final passes.
No migration, hosted query, client data change, commit, push or deployment.
Next: remaining activity/project-detail/document consumers and messages, then
reports/import/export/new-document terminology. R3(b) is still in progress; R4-R5
remain pending. See INDUSTRY_NEUTRAL_R3.md for exact coverage and evidence.

## Industry-neutral R3(b), batch 1 terminology foundation (2026-10-17)

Implemented locally: module-owned allowlisted terminology catalogs (18 singular/
plural record labels), application composition, shared resolver, tenant/key storage,
revision control and Settings > Terminology. Only active tenant administrators
may edit. Module dependencies, normalized collisions and fixed control labels are
checked; reset restores defaults without losing history. Saves recheck access after
the shared tenant lock and commit strict audit/revision/label changes atomically.
44 checks passed: 41 unit/architecture/integration and three local browser workflows.
Production build/TypeScript (135 pages), targeted lint and whitespace passed.
Desktop/mobile settings screenshots reviewed. Migration 20261017120000 adds two
forced-RLS configuration tables; applied only to the disposable local database.
No existing data rewrite, hosted query, production migration, push or deployment.
R3(b) remains in progress: next apply labels consistently to consumer screens,
reports, imports/exports and new documents, retaining contextual defaults and
historical snapshots. R4-R5 remain pending. See INDUSTRY_NEUTRAL_R3.md.

## Industry-neutral R3(a) custom-field ownership (2026-10-17)

R3(a) is implemented and verified locally. Application composition registers the
existing field resources; modules own team/project context validation and explicit
batched export context queries. Platform checks module dependencies and rejects
mismatched resource/scope requests. Shared typed inputs now live in components/erp.
Existing IDs, types, scopes, required cohorts, stored values, permission rules,
import mappings and historical quotation snapshots remain intact. No schema change.
69 checks passed: 63 architecture/integration and six local browser sales workflows.
Production build/TypeScript (134 pages), targeted lint and whitespace passed.
No hosted query, client data change, migration, push or deployment. No new visual
acceptance claim. Next: R3(b), terminology catalog/store/resolver and administrator
configuration, followed by consumer coverage. R4-R5 release work remains pending.
See INDUSTRY_NEUTRAL_R3.md and INDUSTRY_NEUTRAL_REFACTOR.md.

## Industry-neutral R2 completion review (2026-10-17)

R2(a-d) is complete locally. CRM contracts, dashboard composition, shared UI,
Sales Documents contracts and operational service boundaries were reviewed against
R1 scope. The remaining coupon wait-time access gap now uses the shared booking
transaction with distinct coupon permissions. Core/import test fixtures use the
runtime tenant adapter. HTTP adapter boundaries have regression coverage.
445 distinct local checks passed: 69 unit, 191 operational/access/migration,
159 sales-domain integration and 26 browser workflows. Build/TypeScript (134 pages),
targeted lint and whitespace passed. Four older-schema migration fixtures remain
explicitly skipped/pending R5; they are not counted as passes. The tenant-default
schedule index fixture passed. The concurrent-plan case passed the full aligned
suite and three extra isolated runs after an initial failed/stalled fixture run.
Selected mobile import/dashboard and mobile/module-off report screenshots reviewed.
No hosted query, client data change, production migration, push or deployment.
Next: R3(a), resource-owned custom-field registration and contextual validation;
then terminology configuration and consumers. R4 view isolation and R5 protected
release rehearsal remain pending. Existing catalog audit delivery and client-form
version limits are documented rather than claimed as newly strengthened.
See INDUSTRY_NEUTRAL_R2.md and INDUSTRY_NEUTRAL_REFACTOR.md.

## Industry-neutral R2(d), batch 24 checkpoint (2026-10-17)

Single and bulk appointment changes now synchronize linked order-line staff/times
and saved duration atomically. The header uses the earliest retained service-line
start and tenant-local date. Siblings and financial snapshots stay unchanged.
Linked customer/service changes go through the order editor; started/completed
schedules and unconfirmed-parent activation are protected. Ambiguous/foreign
links fail closed. Individual cancellation/completion does not infer order status,
coupon usage or stock changes. Those remain explicit order actions. Parent revision
and linked before/after audits commit with appointment changes, or all roll back.
All appointment/order writers now share fresh under-lock access checks; standalone
creation also uses a strict atomic audit. Batch reads are tenant/line scoped.
214 distinct local checks passed, including 8 browser workflows, plus production
build/TypeScript (134 pages), targeted lint and whitespace. No visual review claimed.
No schema migration, hosted query, client data change, push or deployment. Next:
R2(d) completion review before R3 common configuration. R3-R5 remain pending.
See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 23 checkpoint (2026-10-17)

Existing Flexible weekly/active recurring plan changes now capture missing past
history before mutation, including the full old range of displaced patterns.
Saved snapshots remain unchanged; tenant/mode scoping, tenant-yesterday cutoffs,
merged ranges and 366-date source batches bound capture. Draft/dormant plans do
not snapshot unrelated history. New backdated records may populate missing history.
Explicit corrections stay in existing daily-date/leave workflows with precedence,
booking guards and strict atomic audits. Capture or audit failure rolls back all writes.
Past roster display uses saved bounds and paid minutes rather than current template
hours/breaks; exact historical break layouts are not available in existing snapshots.
206 distinct local checks passed, including 8 browser workflows, plus production
build/TypeScript (134 pages), targeted lint and whitespace. No visual review claimed.
No migration, hosted query, client data change, push or deployment. Next: reverse
appointment/order synchronization. R2(d) in progress; R3-R5 pending.
See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 22 checkpoint (2026-10-17)

Daily override and Flexible slot saves/deletions now share effective-availability
booking safeguards. Conflicts roll back the whole change; compatible fallback and
higher-priority weekly/recurring/override/leave coverage remain valid. Daily checks
use affected staff, padded UTC query bounds and exact tenant dates. Candidate reads
are paged and sources batched. The existing conflict-resolution response is retained:
only after rollback, current Appointments access determines whether details may be
loaded. Restricted users receive counts without booking/customer details.
Fresh module/role/permissions and slot mode are checked after waiting. Roster writes,
corrected history and strict before/after audits commit together. Empty deletions and
fully skipped ranges emit no audit; historical daily corrections still affect only
selected dates. 201 distinct local checks passed, including 8 browser workflows,
plus production build/TypeScript (134 pages), targeted lint and whitespace.
No migration, hosted query, client data change, push or deployment. Next: explicit
historical plan-correction policy and reverse appointment/order synchronization.
R2(d) remains in progress; R3-R5 pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 21 checkpoint (2026-10-17)

Standard schedule changes, assignment endings and shared template edits now protect
valid active/future bookings under the common scheduling lock. Default changes
cover unassigned Standard staff; shared templates also protect Flexible overrides.
Compatible fallback is allowed; existing invalid bookings do not block repairs.
Shared plan helpers retain paged/scoped booking reads and batched source resolution.
Fresh role/module/permissions are checked after waiting. Main writes, child records
and strict audits (including displaced defaults) commit or roll back together.
History captures preserve saved snapshots; templates referenced by history cannot
be deleted. Repeated assignment endings are no-ops. 194 distinct local checks,
production build/TypeScript (134 pages), targeted lint/whitespace passed, including
8 local browser workflows. No migration, hosted query, client data change, push or
deployment. Next: daily override/slot mutation safeguards, explicit historical
corrections and reverse appointment/order policy. R2(d) remains in progress;
R3-R5 pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 20 checkpoint (2026-10-17)

Flexible weekly/recurring plan changes now reject newly invalid active/future
bookings under the shared scheduling lock, including overdue in-progress work,
far-future bookings and dates outside displaced patterns' replacement ranges.
Candidate reads are paged, source reads batched, and errors omit customer details.
Compatible changes retain existing precedence and do not rewrite saved history.
Writer role/module/permissions are rechecked after waiting. Plan changes, strict
before/after audits and displacement audits commit together; failed audits roll
back everything. Duplicate wrapper audits removed; repeat deletion/deactivation
is a no-op. 188 distinct local checks and production build/TypeScript (134 pages)
passed, including 8 browser workflows; targeted lint/whitespace passed. Local test
database stopped. No migration, hosted query, client data change, push or deployment.
Next: Standard schedules/templates/assignments, explicit historical plan corrections
and reverse appointment/order policy. R2(d) remains in progress; R3-R5 pending.
See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 19 checkpoint (2026-10-17)

Standard live availability, roster history and roster display share schedule-start
rotation and week-off rules. Assignment dates bound applicability without restarting
the cycle; default schedules fill unassigned dates, never assigned off days. Scoped
range loads and cached schedule maps avoid per-date queries/repeated calculations.
Standard/Flexible/override break segments are shared; existing history snapshots
remain unchanged during normal capture. No retrospective repair or migration.
181 distinct local checks passed, including 8 browser workflows. Production build/
TypeScript passed (134 pages); targeted lint/whitespace passed. Local test database
stopped. No hosted query, client data change, push or deployment. Next: plan-change
booking effects/transactional audits and reverse appointment/order policy. R2(d)
remains in progress; R3-R5 pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 18 checkpoint (2026-10-17)

Flexible roster history and live availability now use one range loader/resolver
for weekly plans, recurring cycles and daily slots, including breaks, explicit off
days and sparse-day fallback. Leave and daily overrides retain higher precedence.
History loads selected Flexible staff in batches; resolving further dates adds no
queries. Normal missing-history capture preserves existing snapshots; explicit
corrections remain limited to their affected dates. No retrospective repair.
176 distinct local checks passed, including 8 browser workflows. Production build/
TypeScript passed (134 pages); targeted lint/whitespace passed. Local test database
stopped. No migration, hosted query, client data change, push or deployment.
Next: Standard schedule history parity, plan-change effects/transactional auditing
and reverse appointment/order policy. R2(d) remains in progress; R3-R5 pending.
See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 17 checkpoint (2026-10-17)

Staff scheduling-mode changes now use a Workforce service and the shared scheduling
transaction before user-security row locks. Checks reread current role/module access,
use tenant calendar cutoffs, and block changes until active/future bookings are
resolved explicitly (including overdue in-progress appointments). No plan deletion
or history rewrite. Mode, profile/user changes and strict audit commit together;
responses return saved details and unexpected errors use a safe server message.
180 distinct local checks passed, including 8 local browser workflows. Production
build/TypeScript passed (134 pages); targeted lint and whitespace passed. Local test
database stopped. No migration, hosted query, client data change, push or deployment.
Next: unify weekly/recurring plan history precedence with live availability, then
plan-change effects/auditing and reverse appointment/order policy. R2(d) remains
in progress; R3-R5 are pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 16 checkpoint (2026-10-17)

Resolved the nested-plan RLS failure: interactive timeouts could leave a late query
running after rollback. The adapter now blocks queries when completion begins;
timeout/reuse tests verify rollback and tenant isolation. Flexible plan saves and
clones use parent-first bulk inserts per level without changing RLS policies.
Leave review/cancel/revoke and bulk review share the scheduling lock, recheck record
scope and booking conflicts, use tenant midnight, and commit status/history/audit
atomically. Notifications follow commit; unexpected failures use safe server errors.
192 distinct local checks passed, including 8 browser workflows. Production build/
TypeScript passed (134 pages); targeted lint/whitespace passed. Recurring-plan and
leave-conflict screenshots inspected. No migration, hosted query, client data change,
push or deployment. Local test database stopped afterward. Next: staff-mode writer
coordination, plan-change history/booking effects and reverse order policy. R2(d)
is still in progress; R3-R5 remain pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 15 checkpoint (2026-10-17)

Booking pricing previews now use the saving service for coupon eligibility, usage,
taxes and line totals. The editor debounces/cancels requests and requires a current
successful preview before saving; notes retain saved financial snapshots. Summary,
editor and invoice share net-subtotal display semantics without altering saved
amounts; invoice rates preserve quoted prices and mark inclusive tax.
178 distinct local checks passed, including 8 browser workflows; production build/
TypeScript passed (134 pages). Lint/whitespace passed with the existing tenant-screen
warning. Invoice and browser totals screenshots inspected. No migration, push,
deployment or client data change. Initial combined-run Workforce nested-plan RLS
failures did not reproduce on rerun; investigation remains required, not resolved.
Next: Workforce coordination/RLS investigation and reverse order policy. R2(d)
is still in progress; R3-R5 remain pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 14 checkpoint (2026-10-17)

Booking taxes now resolve catalog defaults after loading catalog references, retain
explicit empty selections/zero prices, reject unavailable IDs and preserve inclusive
pennies. Scheduling/metadata retains saved tax snapshots; financial edits use current
active definitions. Real dates, clock values, percentages, array and monetary limits
are validated. Shared tenant-time validation handles partial edits, UTC-midnight
boundaries and DST gaps/repeated hours without overwriting unrelated fields.
172 distinct local checks passed, including 7 browser workflows; production build/
TypeScript passed (133 pages). Lint/whitespace passed with the existing tenant-screen
warning. Local database stopped. No migration, push, deployment or client data change.
Next: unify editor/server pricing and coupon eligibility/subtotal display semantics;
then remaining Workforce coordination. R3-R5 remain pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 13 checkpoint (2026-10-17)

Coupon and invoice routes now delegate to shared Appointments module services.
Coupon edits preserve omitted settings and validate merged dates/discounts. Coupon
mutations share the booking lock and commit audits atomically; used codes cannot
be renamed and referenced coupons are deactivated. Global/per-customer usage limits
use bounded database aggregates over non-canceled orders, excluding an edited order.
Invoices share saved prices and tenant time and now include product lines. Email
keeps separate edit/export gates and post-delivery audit semantics; tests stub SMTP.
166 distinct local checks passed, including 7 browser workflows; production build/
TypeScript passed (133 pages). Lint/whitespace passed with one existing tenant-screen
warning. Generated invoice PDF was visually inspected. Local database stopped.
No push, deployment, new migration or client data change. Next: default taxes,
financial recalculation and full booking date/time validation; then remaining
Workforce coordination. R3-R5 remain pending. See INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 12 checkpoint (2026-10-17)

Order detail/edit now use shared module services and the tenant scheduling lock.
Edits preserve line and appointment IDs, terminal history and saved prices/durations
for metadata/status changes. Stock transitions and strict edit audits commit with
the order. Repeated status commands are idempotent; stale preflight and foreign/
duplicate line IDs are rejected. Referenced lines cannot be deleted.
Booking editor/summary now use tenant wall time; a browser save verified unchanged
Asia/Kolkata scheduling from Los Angeles. 158 distinct local checks passed,
including 7 browser workflows; production build/TypeScript passed (133 pages).
Lint/whitespace passed with one pre-existing tenant-screen hook warning.
No push, deployment, new migration or client data changes. Next: coupon/invoice
extraction and financial/date-time validation. Reverse synchronization from
individual appointments to orders and remaining Workforce coordination still need
an explicit policy and implementation; see INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 11 checkpoint (2026-10-16)

Booking order listing and creation now use shared module services. Confirmed
creation rechecks availability, catalog data and coupon usage inside the tenant
scheduling transaction; order, linked appointments, stock and audit commit together.
Shared inventory deductions now guard against concurrent overselling. Draft creation
avoids unnecessary preflight reads. Existing response contracts and gates remain.
149 distinct local checks passed, including 6 browser workflows. Production build
and TypeScript passed (133 pages); lint has no errors and one existing warning.
No push, deployment, new migration or client data changes. Next: order detail/edit
and linked appointment history/status coordination, then coupon/invoice extraction.
Order PATCH and remaining nonparticipating writers are not covered by the create
lock guarantees; see INDUSTRY_NEUTRAL_R2.md for the remaining limits.

## Industry-neutral R2(d), batch 10 checkpoint (2026-10-16)

Appointment detail/edit/cancel and bulk resolution now use shared module services.
Mutations reuse the scheduling lock and commit their audit events in the same
transaction. Fixed status-only reactivation, missing bulk working-hour/customer
checks and within-batch conflicts. Saved durations and bulk offsets are preserved;
missing selections fail as a whole and repeated cancellations are idempotent.
125 distinct local checks passed, including 6 browser workflows; production build
and TypeScript passed. Changed-file lint: no errors, one existing warning.
No push, deployment, new migration or client data changes. Next: order/coupon/
invoice workflows and linked appointment coordination; remaining Workforce
history and nonparticipating writers are still tracked in INDUSTRY_NEUTRAL_R2.md.

## Industry-neutral R2(d), batch 9 checkpoint (2026-10-16)

Appointment list/create and availability routes now use shared module services.
List dates use tenant-local boundaries; paging has stable ordering. Shared
projections/serialization serve list/create/detail. Availability validates
excluded appointment ownership. Standalone creation uses the shared schedule
transaction and reads availability on that same connection, preventing overlapping
concurrent standalone creates and rechecking hours after schedule changes.
118 distinct local checks passed, including 6 browser workflows; production build
and TypeScript passed. Changed-file lint: no errors, one existing warning.
Nothing pushed, deployed or applied to production. Next: appointment edit/bulk,
order/coupon/invoice extraction and remaining booking/workforce coordination.
Other booking writers and weekly/recurring history alignment remain pending.
See INDUSTRY_NEUTRAL_R2.md for evidence and limits.

## Industry-neutral R2(d), batch 8 checkpoint (2026-10-16)

Weekly plans and recurring pattern list/detail/save/clone/deactivate/preview
routes now use shared Workforce services. Common nested records replace repeated
writers; the transitional workforceSession adapter is removed. Weekly/recurring
writes share the scheduling lock. Fixed clone-source overlap, actual-state
activation permission checks and clone destination audit IDs. Preview uses real
business dates, save validation and an inclusive 90-day horizon. Existing weekly
and recurring availability precedence is verified.
96 distinct local checks passed, including 6 browser workflows; production build
and TypeScript passed. Changed-file lint has no errors and one existing warning.
Nothing pushed, deployed or applied to production. Next: remaining appointment
extraction and booking/workforce coordination, including weekly/recurring history.
See INDUSTRY_NEUTRAL_R2.md for detailed evidence and remaining limitations.

## Industry-neutral R2(d), batch 7 checkpoint (2026-10-16)

Daily roster overrides, flexible slots and history now use shared Workforce
services. Fixed unmatched staff filters, foreign-template validation and business
calendar-date conflict checks. Daily mutations/history commit together using the
shared schedule lock; skipped dates and existing read-time snapshots are retained.
History helpers moved into Workforce with mandatory tenant scope and UTC DATE
arithmetic. Weekly/recurring plans and broader booking coordination remain next.
89 local checks passed, including 5 browser workflows; production build and
TypeScript passed. Changed-file lint: no errors, one existing tenant-screen warning.
No push, deployment or production data/schema changes. Batch-6 default-schedule
index migration remains pending for R5. See INDUSTRY_NEUTRAL_R2.md for evidence,
remaining concurrency/fallback limits and historical-date reconciliation notes.

## 2026-10-16: Industry-neutral R2(d), sixth operational batch (local)

Leave options/approved queries and standard schedule/assignment services now live
in Workforce; six more routes are HTTP adapters. Shared validation/projections
preserve access and response contracts. Unmatched staff filters no longer expand
to all assignments; mixed foreign selections fail without partial saves. Standard
schedule writes serialize per tenant, retain overlap checks and atomically save
history/default/block/assignment changes. Default-change permission checks and
displaced-ID audit records are based on the locked state.
Prepared and locally applied migration `20261016170000_tenant_default_shift_schedule`:
replace the old global default index with tenant-specific uniqueness, with no row
rewrites. Production application remains deferred to R5, including protected-copy
reconciliation and restore rehearsal. No production changes, push or deployment.
Verification: 45 CRM/unit/architecture, 4 Workforce unit, 24 Workforce RLS integration,
2 migration and 5 local browser checks passed (80 total; no skips). Build/TypeScript,
whitespace and local migration status passed; lint has no errors and one existing
tenant-screen hook warning. Leave-reschedule screenshot inspected; local DB stopped.
Next R2(d): roster/override/flexible-plan services and roster date handling, then
remaining booking coordination. See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md).

## 2026-10-16: Industry-neutral R2(d), fifth operational batch (local)

Leave request list/detail/submission and review/cancel/revoke/bulk orchestration
now belongs to `modules/workforce/leave-request-service.ts`. Six routes retain
HTTP validation/response contracts and existing module/action authorization.
Direct-report, personal access and conflict-detail privacy checks are preserved.
Conditional status writes reject competing stale actions; bulk counts, audits and
notifications use only IDs actually changed. Past roster refreshes commit with
the status change and roll back together on failure. Existing post-commit audit
and notification delivery behavior is retained. No schema or production changes.
Verification: 45 CRM/unit/architecture, 4 Workforce unit, 19 Workforce RLS
integration and 5 local browser tests passed, no skips. Build/TypeScript passed;
changed-file lint has no errors and one pre-existing tenant-screen hook warning.
Leave-reschedule screenshot inspected. See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md)
for limits, including remaining booking coordination and roster timezone review.
Next R2(d): leave options/approved lists and remaining shift scheduling/roster
services. R3-R5 remain pending. Nothing pushed/deployed; local test DB stopped.

## 2026-10-16: Industry-neutral R2(d), fourth operational batch (local)

Leave definition/group services, request rule/timeline helpers and notifications
now live in Workforce; their four former API helper files were removed. Definitions,
groups and shift templates use thin routes with existing module/action/audit gates.
Shared leave helpers require tenant scope, including relationship and notification
queries. Shift table paging is validated and existing selector/sort behavior remains.
Fixed an existing partial-edit default bug that could reset leave configuration or
change selective group assignment to all staff. Omitted fields now stay unchanged;
explicit clears/false/zero remain supported. No stored data repair or schema change.
Local verification: 45 CRM/unit/architecture, 4 Workforce unit, 13 Workforce RLS
integration and 5 browser tests passed; no skips. Build/TypeScript/whitespace passed;
lint has no errors and the same existing tenant-screen hook warning. Integration
and build/browser checks were repeated after preserving template-table sort fallback.
Leave-reschedule screenshot inspected. See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md).
Next R2(d) work: leave-request workflow orchestration and remaining shift schedule/
assignment/roster/flexible-plan routes. R3-R5 remain pending. Nothing pushed or
deployed; production is untouched. The disposable database was stopped after checks.

## 2026-10-16: Industry-neutral R2(d), third operational batch (local)

Inventory categories/suppliers and Services catalog/categories now own reusable
list/create/edit/archive services. Typed projections are shared per resource;
service creation/editing reuse tenant-scoped category/package/tax validation.
Eight routes retain HTTP contracts and existing activation/permission/audit gates.
Referenced records keep their existing inactive/archive behavior. No schema or
stored data changes, forwarding layers or generic CRUD framework were introduced.
Local verification: 45 unit/architecture, 28 integration and 5 browser tests passed;
no skips. Build/TypeScript/whitespace passed. Lint has no errors and the same existing
tenant-screen hook warning. Leave-reschedule screenshot inspected.
See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md). Workforce Leaves/Shifts rules are
next in R2(d); R3-R5 remain pending. Nothing pushed or deployed; production is
untouched. The disposable local database was stopped after verification.

## 2026-10-16: Industry-neutral R2(d), second operational batch (local)

Product and purchase rules moved to Inventory services with shared projections,
serializers and relationship validation. Purchase receipt updates lock the scoped
purchase row and retain cumulative quantities; repeated/concurrent receipts no
longer add stock twice. Movement inserts are batched. Purchase responses now show
current received quantities and notes. No stored data or schema is rewritten.
Operational dashboard queries belong to their modules, with activation/read gates;
application composition and date policy are in application/dashboard. The dashboard
route reuses core authorization rather than reloading the access user.
Local verification: 45 unit/architecture, 49 integration and 6 browser tests passed;
no skips. Final Inventory retest passed (15 tests). Build/TypeScript/whitespace
passed; lint has no errors and the same existing tenant-screen hook warning.
Desktop and mobile dashboard screenshots inspected. See
[R2 delivery notes](INDUSTRY_NEUTRAL_R2.md) for receipt checks and remaining R2(d)
category/supplier, service and workforce route work. R3-R5 remain pending.
Nothing pushed or deployed; production data/configuration is untouched.

## 2026-10-16: Industry-neutral R2(d), first operational batch (local)

Appointments owns its order pricing/resolution/scheduling helpers; Workforce owns
staff availability; Inventory owns transaction-bound stock changes. Services
catalog-use access is exposed from its policy. Former helper paths are removed,
without forwarding files. Availability requires explicit tenant scope. Tenant and
organization descriptions now say business tenant. No stored names/schema changes.
Local checks: 43 unit/architecture, 40 database integration and 5 browser tests
passed; build/TypeScript and whitespace passed. Lint has no errors and one existing
tenant-screen hook warning. Leave/reschedule screenshots inspected. See
[R2 delivery notes](INDUSTRY_NEUTRAL_R2.md). Purchase/catalog, operational dashboard
and remaining route services are still R2(d) work. R3-R5 remain pending.
No production operations, migrations, push or deployment.

## 2026-10-16: Industry-neutral refactor R2(c), local checkpoint

Sales Documents now receives a narrow transaction/audit/opportunity-scope/context
contract; Real Estate document context is separate from the CRM extension API.
Nine CRM UI wrapper files were removed. Neutral ERP components are imported directly;
permission-aware record controls live in platform/access and retain existing gates.
No schema or saved-document changes. See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md).
Local verification: 41 CRM/unit, 6 calculation, 17 database integration and 23 browser
tests passed, no skips; focused mobile import selector rerun passed. Build, TypeScript,
changed-file lint and screenshot review passed. R2(d) and R3-R5 remain pending.
Nothing pushed or deployed; Ewissen data and production are untouched.

## 2026-10-16: Industry-neutral refactor R2(b), local checkpoint

Dashboard queries/types/widgets now belong to CRM, Real Estate and Sales Documents;
`application/dashboard` composes them and shared presentation stays module-neutral.
Application route metadata is injected into platform access controls. Generic
constraint/retry helpers moved to platform, removing reverse CRM dependencies.
KPI definitions, response shape, access rules and persistence remain unchanged.
See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md). Local verification: 40 unit,
13 database integration and 11 browser tests passed, with no skips. Build,
TypeScript, targeted lint and desktop/mobile screenshot review passed.
R2(c-d) and R3-R5 remain pending. No push, deployment or hosted data changes.

## 2026-10-16: Industry-neutral refactor R2(a), local checkpoint

CRM query, report, export and import boundaries now obtain industry-specific
behaviour from extension contracts. Real Estate owns its project validation,
report columns/grouping and dependent import choices. No schema or client-data
migration is needed for this batch. See [R2 delivery notes](INDUSTRY_NEUTRAL_R2.md).
Local checks: 36 unit, 13 import integration, 104 broader integration and 7 browser
tests passed; 4 historical migration-fixture cases were skipped. Production build,
TypeScript and targeted lint passed; desktop/mobile screenshots were inspected.
R2(b-d) and R3-R5 remain pending. Nothing pushed or deployed; no hosted data touched.

## 2026-10-16: Industry-neutral refactor R1 audit

R1 repository audit and migration design are complete. See the active
[R1-R5 refactor plan](INDUSTRY_NEUTRAL_REFACTOR.md) for the file-level
scope, data-preservation invariants, verification gates and cutover plan.
R2-R5 are not implemented. Local CRM baseline: 33 tests passed. No
production access, application changes, migrations, push or deployment
were performed. Production stays on the current release until R5.

## 2026-10-06: Enquiry spreadsheet import

CSV/XLSX upload, column mapping, read-only row validation, resumable import and
correction download are implemented. Duplicate email/phone rows are skipped with
no updates or contact reuse. Shared enquiry, property and custom-field rules apply.
See [enquiry import](CRM_ENQUIRY_IMPORT.md) for limits, access and verification.
Migration: `20261006100000_enquiry_import`.

## 2026-09-29: Project detail interface (release)

Projects and subprojects now share a read-only overview, record-local tabs and
focused section edit panels. Optional creation fields are collapsed and currency
defaults to business settings. Shared empty pagination is hidden. No schema or
API changes; no hosted data writes. Push/deployment via main is authorized. See [UI delivery notes](CRM_PROJECT_DETAIL_UI.md).

## 2026-09-29: Modular navigation and optional Sales Documents (release)

Sidebar-only CRM, Contacts, Activities, Sales Documents and Real Estate groups
are implemented. Sales Documents and its Payment Plans capability have separate
tenant switches, dependency checks and server enforcement. Quotation code is
extracted from CRM; existing URLs and saved versions are retained. See
[delivery notes](CRM_MODULE_NAVIGATION_DELIVERY.md). The additive flag-backfill
migration is applied (87 migrations up to date); application release is authorized
via main. Hosted workflow verification remains pending.

## 2026-09-29: Quotation / payment-plan documents (release)

Reusable quotation templates, exact charges/instalments, immutable versions and
PDF download are implemented. See [delivery notes](CRM_QUOTATIONS_PAYMENT_PLANS.md).
The [four-phase checkpoint](CRM_CHECKPOINT_2026_09_29.md) is already pushed, migrated
and deployed. The quotation migration is also applied; all 86 hosted migrations are up to date.
Application release is authorized via main.
Full hosted workflow verification remains deferred by user instruction.

## 2026-09-29: CRM checkpoint release

The three Odoo-alignment migrations (project choices, custom fields and sales
teams) have applied successfully to the hosted database. Application deployment
`df1b560` is Ready on Vercel, including CRM Test. Per user instruction, full hosted
workflow verification is deferred
until after quotation/payment-plan implementation. Prior local checks remain
recorded in the phase documents; they are not hosted acceptance results.

## 2026-09-29: Odoo alignment Phase 4 (local, not deployed)

Sales teams, member assignment, qualification/direct-opportunity workflows,
team-scoped custom fields and reviewed configuration presets are implemented.
Existing staff visibility and unassigned-record workflows are preserved. Team
filters reconcile sales reports and exports. See [Phase 4 delivery and checks](CRM_ODOO_PHASE_4.md).
No hosted data or migrations changed. Payment-plan documents are the next agreed
feature; collections and accounting remain deferred.

## 2026-09-29: Odoo alignment Phase 3 (local, not deployed)

Shared typed custom fields now cover enquiries, opportunities and Real Estate
projects. Manager configuration, prospective required rules, permissions,
conversion snapshots, indexed filters and batch CSV exports reuse one engine.
See [Phase 3 delivery and verification](CRM_ODOO_PHASE_3.md). Phase 4 sales teams
and workflow presets remain planned. No hosted records or migrations changed.

## CRM Odoo alignment Phase 2 - 2026-09-29

Implemented locally: configurable project statuses, shared property categories
and buying timeframes under CRM Configuration > Real Estate. Includes tenant
catalogs, defaults, ordering, archive/restore, searchable selectors and preserved
labels. The additive migration was verified against existing local fixture data;
CRM regressions and desktop/mobile browser checks passed. See
[CRM_ODOO_PHASE_2.md](CRM_ODOO_PHASE_2.md) for verification and release/recovery.
No hosted migration or deployment was performed. Custom fields are the next phase.

## CRM Odoo alignment Phase 1 - 2026-09-29

Implemented locally: injected CRM extension contracts, application composition,
Real Estate server/view adapters and CRM Configuration navigation. Core CRM no
longer imports Real Estate implementations. Existing APIs and data remain compatible;
no migration is required. See [CRM_ODOO_PHASE_1.md](CRM_ODOO_PHASE_1.md) for checks
and local-versus-hosted status. Configurable project choices are the next phase.

## Odoo benchmark and early refactor decision - 2026-09-29

The active forward plan is [CRM_ODOO_ALIGNMENT_PLAN.md](CRM_ODOO_ALIGNMENT_PLAN.md).
It preserves shared CRM and optional Real Estate, prioritizes industry integration
boundaries, configurable project choices and reusable additional fields, then
sales-team workflow configuration. These refactors are planned, not implemented.
Existing CRM Test leads remain the regression baseline; no pilot or import is requested.
Older deployment notes below are historical; the latest recorded release baseline
is commit `3e2971c`, including configurable activity types.

## Configurable CRM activity types - 2026-09-28

Tenant-specific activity types, inherited behaviours, defaults, filters and history
are implemented. See [CRM_ACTIVITY_TYPES.md](CRM_ACTIVITY_TYPES.md) for setup and verification.

## Configurable lost reasons - 2026-09-28

Shared enquiry/opportunity reasons, conditional closing controls, scoped filters,
reporting and historical-label preservation are implemented. See
[CRM_LOST_REASONS.md](CRM_LOST_REASONS.md) for configuration and verification.

## CRM Phase 6 internal regression - 2026-09-28

Phase 6 now uses the existing CRM Test leads, as requested by the user.
Read-only admin/staff checks and an upgrade baseline are in
[CRM_SALES_PHASE_6.md](CRM_SALES_PHASE_6.md). The hosted business still lacks
Phase 2-5 endpoints; deployment and new sales workflow checks remain pending.
No client pilot or legacy import is part of this step.

## CRM sales extension milestone - 2026-09-28

Phases 2-5 are implemented and verified locally, pending deployment.
See [Phase 2](CRM_SALES_PHASE_2.md) for lead intake and
[Phase 3](CRM_SALES_PHASE_3.md) for optional Real Estate projects, module
dependencies, staff access, migration and verification.
[Phase 4](CRM_SALES_PHASE_4.md) adds optional project-linked enquiries/opportunities,
buyer requirements, preserved conversion context, project sales views and an
explicit editable pipeline draft. [Phase 5](CRM_SALES_PHASE_5.md) adds scoped sales
reporting, reconciling drill-downs and bounded CSV exports. The active delivery
sequence is [CRM_EXTENSIBILITY_PLAN.md](CRM_EXTENSIBILITY_PLAN.md).

# Modular business platform — CRM milestones 1–7

## Contact workspace UI — 2026-09-28

The contact detail view uses separate cards for contact information, business
accounts, activities and shared interaction history. Fixed choices use the shared
shadcn/Radix `DropdownSelect`; large record choices retain server-side searchable
comboboxes. Contact activities expose search and status, group secondary filters
in a labelled popover, and place Apply plan / Log interaction in More actions.
Mobile activities use cards; empty sections omit redundant tables and pagination.

`CrmSection` provides the section pattern for further CRM work. The compact work
list, interaction card and pagination treatments are opt-in on this view; other
CRM screens retain their current layout. Contact saves, archive/unlink confirmation,
server pagination, record context, permissions and version checks are preserved.
No API or database changes are required. Seven browser checks exercise the real
components with intercepted test data and writes, including filters, pagination,
archive/restore, account relationships, staff read-only access and mobile themes.

Customer interactions and activity history/internal notes now share a connected
timeline with event icons, author initials, timestamps and separate message cards.
Both timelines use centered, independently paginated controls. Internal notes
retain their permission checks and history retains business-time-zone formatting.
Local browser verification covers light/dark themes, mobile layout, centered
pagination, note submission and read-only access; history-format regressions pass.

## Architecture decision

Keep one Next.js application and PostgreSQL database. The business tenant is the
isolation boundary. Organization remains the parent/provisioning grouping; it does
not grant implicit access to tenant CRM records. A property development is a
business record, not a tenant. Property renters are unrelated to SaaS tenants.

`platform/` owns business request context, module metadata and shared errors.
`modules/crm/` owns contacts, business accounts, their relationships, enquiries,
tasks, activity, validation and operations.
`app/` contains thin API entry points and pages. Existing UI primitives are reused.
CRM operations recheck the current active user and enabled module, enforce record
scope and run changes and required audit entries in one transaction. Serializable
transaction conflicts are retried up to twice; record edits also carry a version.
Other modules and future integration adapters must call these operations.

The first independently switchable module is CRM. Legacy salon, inventory,
purchasing and workforce routes are deliberately not advertised as switchable:
their server boundaries must first be extracted and tested. Existing salon
navigation, authentication, pricing and booking paths are preserved.

## Implemented

- Per-business CRM enable/disable at `/settings/modules`, restricted to current
  active business administrators. Disable preserves all records.
- Independent contacts, with name and optional email/international phone. A
  contact can have many enquiries and needs no password or login account.
- Exact email/phone duplicates rejected within a tenant, including concurrent
  creates. Emails are normalized to lowercase; phone formatting is normalized to
  international `+` form. Names alone are not treated as proof of duplication.
  Duplicate responses do not reveal inaccessible contact details.
- Contact editing and archiving, enquiry creation, assignment, requirements,
  source, status and required closure outcome.
- Enquiry notes, activity history, date-only follow-ups, completion and overdue
  filters. Follow-ups belong to the enquiry and follow its current assignment.
- Server pagination and search for contacts, enquiries, tasks, activity and
  salesperson/contact selectors.
- Administrators/managers see the tenant's CRM records. Staff see contacts they
  own or contacts linked to their assigned enquiries; they may edit only their
  own contacts. Staff can work only on enquiries assigned to themselves and cannot
  assign another salesperson. Customer accounts and platform-console users have
  no CRM access. Teams/custom permission bundles are a later milestone.
- Non-null tenant IDs, composite tenant foreign keys, RLS on all new tables,
  transactional audit records and optimistic edit conflict detection.

This is enquiry tracking. NEW / CONTACTED / QUALIFIED / CLOSED are initial fixed
enquiry statuses, not the future configurable opportunity pipeline. Follow-ups
are manually tracked; no automatic reminders, scheduler or retry worker is enabled.

## Additive migration and rollout

`prisma/migrations/20260923090000_crm_foundation/migration.sql` adds five tables,
one enum and a composite User uniqueness constraint. It drops no existing table
or column and rewrites no existing customer/account data. CRM defaults to disabled.
The migration uses the existing `app.tenant_match` RLS function.

1. Review and apply the migration through the existing controlled database
   deployment process. Do not use a reset or `db push` on an existing database.
2. Generate the Prisma client and deploy the application together with the schema.
3. A business administrator enables CRM under Settings → Modules.
4. Create a contact, create an enquiry, assign a salesperson and add a follow-up.
5. Verify staff and tenant boundaries in the target staging environment before
   enabling CRM for additional tenants.

On 2026-09-23, following the user's explicit request to apply migrations, this
migration was deployed to the configured Supabase database with `prisma migrate
deploy`. It was the only pending migration. Post-deployment migration status was
up to date and a read-only schema diff reported no differences. Existing record
counts were unchanged; no CRM demo/test records were added to that database.
CRM remains disabled by default until a business administrator enables it.

Before deployment, the incremental migration was tested on an isolated,
disposable local PostgreSQL instance initialized with the pre-change schema and
existing RLS. All write-based workflow tests use the disposable database.

`CrmContact.legacyUserId` is an optional tenant-safe bridge for a later, reviewed
salon customer import. No automatic backfill or merge occurs. Existing appointment
customer IDs still refer to User. New restrictive CRM foreign keys intentionally
prevent legacy seed/reset/user-delete operations from silently deleting referenced
CRM data; reset/import tools need a separate CRM-aware design before broader use.

## Identity and industry extension roadmap

1. Business accounts and contact/account relationships are implemented in milestone
   2 below. Purchasing can later link supplier profiles to them. Authentication
   `Account` and platform `Organization` remain separate from CRM companies.
2. Opportunities and configurable pipelines are implemented in milestone 3 below.
   Next, deliberate contact merging needs relation reassignment, permissions and history. Shared phone/email
   exceptions require an explicit duplicate policy before relaxing uniqueness.
3. Migrate login identity separately: introduce tenant memberships, backfill from
   existing User tenant/role assignments, verify membership-based access, then
   migrate sessions and staff references. Keep current login available during the
   transition. Never link identities purely from unverified matching contact data.
4. Move service booking, inventory/purchasing and workforce operations behind
   module boundaries incrementally, with regression tests for each extraction.
5. Real estate owns developments, units, listings, viewings, reservations and
   bookings. It consumes CRM contacts/opportunities; it must not overload
   AppointmentOrder or CRM status fields to represent property bookings.
6. Introduce separate billing/payment models with explicit document currency,
   exact monetary precision, receipt allocations and reversals. Existing integer
   cents and appointment totals are not a general accounting ledger.

## Lia boundary

Lia was inspected read-only. Its `docs/APPOINTMENT_ADAPTER_CONTRACT.md` describes
provider operations, scoped identity, confirmation and final availability/
idempotency checks. It is an integration reference, not an existing CRM contract.

The later CRM adapter must map one authorized Lia project to one business tenant
(multiple projects may target a business), authenticate a service actor, enforce
operation capabilities and store idempotency keys and Lia record references.
CRM remains authoritative for business data; Lia owns conversations and flows.
There is no Lia credential, project mapping, webhook or external-write endpoint in
this milestone. No Lia files were changed. Unified login remains a separate plan.

## Verification

No new dependencies are required. `npm run test:crm` uses Node's test runner and
the existing TypeScript compiler for validation/policy and salon pricing checks.

For database tests, use an empty local PostgreSQL database named
`ls_salon_crm_test`, set `CRM_TEST_DATABASE_URL`, then run:

```text
node scripts/prepare-crm-test-db.cjs
npm run test:crm:integration
```

The setup refuses non-local, differently named or non-empty databases. It creates
the current schema, existing/new RLS policies and a non-superuser, non-BYPASSRLS
application role. An optional `CRM_TEST_BASE_SQL` file containing the pre-change
schema tests the full incremental CRM migration instead of generating the current
schema. To test an upgrade from a schema that already includes the first CRM
migration, also set `CRM_TEST_FROM_MIGRATION=20260923120000_crm_business_accounts`.
This setup expects a disposable database with a local trusted test role;
it is not production provisioning guidance.

Database tests cover the complete workflow; raw RLS reads/writes; cross-tenant
foreign keys; staff scopes on details, search and activity; assignments; duplicate
normalization and races; archive behavior; stale edits; concurrent task completion;
audit rollback; disabled/suspended/customer access; and legacy salon relationships.
These checks do not certify every pre-existing salon workflow or the live database.

### HTTP smoke test

After database preparation, run `node scripts/seed-crm-test-demo.cjs` once using
the same local `CRM_TEST_DATABASE_URL`. It creates synthetic `crm-demo` accounts;
it refuses to overwrite an existing fixture. Point a separate application process
at that database's `crm_test_runtime` role, set `APP_ROOT_DOMAIN=localhost`,
`AUTH_TRUST_HOST=true`, `AUTH_URL=http://crm-demo.localhost:3107` and a test-only
`AUTH_SECRET`. Start the built app on `127.0.0.1:3107`, then set
`CRM_TEST_HTTP_ORIGIN=http://127.0.0.1:3107` and run:

```text
node --test tests/crm.http.test.cjs
```

The synthetic credentials in the fixture are public test data, not real accounts.
The test verifies actual sign-in, unauthorized access, module enablement, malformed
JSON, CRM writes, staff access, activity and server rendering for CRM and existing
appointment pages. It does not provide visual or browser interaction coverage.

Verified for milestone 1: Prisma schema/client generation; the additive
migration on a pre-CRM schema; 5 unit/regression tests; 10 PostgreSQL integration
tests; 1 real HTTP workflow test; TypeScript; targeted ESLint; and a production
build. Build required network access for the application's existing Google Fonts.
Visual browser QA is explicitly deferred at the user's request.

### Read-only deployment verification

Set `CRM_VERIFY_CONFIGURED_DATABASE=1` and run `npm run test:crm:migration` to
verify the database configured by `DATABASE_URL`. These checks run inside a
read-only transaction and add no fixtures. They verify all three deployed migration
checksums/history, all eleven forced RLS policies, nineteen validated composite foreign
keys and the runtime database role's lack of superuser/RLS-bypass privileges.
All four deployment tests passed on the configured Supabase database after rollout.
Unit tests and TypeScript checks also passed again during deployment.

## Milestone 2 — business accounts and contact relationships

- `/crm/accounts` supports paginated search, create, edit, archive and restore.
  Accounts store company name, email, international phone, website and notes.
- `CrmAccount` is independent of login accounts, platform organizations and
  suppliers. Identical company names or shared email/phone values are allowed;
  they are not automatically treated as the same legal/business entity.
- Contacts can link to multiple accounts, and accounts can have multiple contacts.
  Manage these relationships on the contact page; inspect permitted contacts on
  the account page. Removal requires confirmation, retains both records, and is
  recorded in audit history. Repeated link/unlink requests do not duplicate audits.
- Administrators/managers can access tenant accounts. Staff can see accounts they
  own or accounts linked to contacts they can already access; only account owners
  and managers can edit account fields. Account visibility or ownership never
  grants access to an otherwise private contact.
- Linking requires an editable contact and an already-visible account. A guessed
  account ID cannot grant access. Archived accounts/contacts reject new links;
  existing relationships remain visible and can be removed by the contact owner
  or a manager. List totals and pagination respect contact-level permissions.
- Account edits use version checks. Account and relationship changes require
  transactional audit entries. The two new tables force tenant RLS; composite
  foreign keys prevent cross-tenant owners and relationships.

The additive migration is `20260923120000_crm_business_accounts`. It creates two
tables with indexes, foreign keys and policies, without altering existing data.
The full upgrade from the previous CRM schema passed in disposable PostgreSQL,
along with 6 unit/regression and 16 database integration tests. The real HTTP
workflow test passed against the production build, covering account creation,
linking, inherited visibility, unauthorized unlinking, and account page responses.
Prisma validation/client generation, TypeScript and targeted ESLint also passed.
Visual browser testing remains deferred.

On 2026-09-23, `prisma migrate deploy` applied the business-account migration to
the configured Supabase database. All four read-only deployment checks passed
against both CRM migrations, seven RLS-protected tables and ten composite foreign
keys. Migration status is up to date and schema diff reports no differences.
No test fixtures were inserted into Supabase; CRM enablement remains a per-business
administrator action. Application hosting deployment is separate from this schema
rollout and has not been performed.

## Milestone 3 — opportunities and configurable sales pipelines

The design follows the common CRM pattern of configurable sales processes,
stage probabilities, owned opportunities, expected close dates and explicit
won/lost outcomes. Reference documentation reviewed:
[Salesforce stage configuration](https://help.salesforce.com/s/articleView?id=000384827&language=en_US&type=1),
[Odoo pipeline analysis](https://www.odoo.com/documentation/18.0/applications/sales/crm/performance/win_loss.html),
and [SugarCRM sales console](https://support.sugarcrm.com/documentation/sugar_versions/25.1/sell/application_guide/user_interface/dashboards_dashlets/sales_console/).
This implements those shared concepts, not all features of those products.

- `/crm/pipelines`: managers/admins create multiple business-specific pipelines.
  A new-pipeline form offers editable sample stages; the actual stages and board
  columns come from tenant data. Managers rename/reorder stages, change colours
  and default probabilities, and archive/restore stages or whole pipelines.
- Each pipeline retains at least one active OPEN, WON and LOST stage. WON is
  100%, LOST is 0%, and OPEN is 0–99%. A stage in use cannot change outcome type.
  Existing stages are archived rather than deleted; deals remain readable and
  can move out to an active stage/pipeline. No automatic data backfill occurs.
- `/crm/opportunities`: Kanban and paginated table views share pipeline, search,
  salesperson, outcome and sort filters. Each board column pages independently
  and displays the full matching count. Drag/drop and the accessible stage
  selector call the same version-checked move operation. Lost moves require a
  reason; errors refresh the board instead of pretending the move succeeded.
- Opportunities require a contact, owner, pipeline/stage, expected close date,
  amount and currency, with an optional business account and description.
  Amounts use `Decimal(18,4)` and JSON decimal strings; they are not integer salon
  cents. Currency is explicit per deal; display respects business number formatting
  and preserves all stored decimal places. There is no exchange-rate conversion,
  cross-currency aggregation or accounting entry in this milestone.
- Stage probability is copied to the opportunity on creation/move and can be
  overridden for open deals. Changing a stage default does not rewrite existing
  opportunities. Closing records a timestamp; reopening clears it and the
  current loss reason while retaining the previous outcome in history/audit.
- An open enquiry can be converted once. Concurrent/repeated conversions reuse
  the same opportunity. Its contact is preserved, and source enquiry history and
  follow-ups remain intact; conversion does not silently close the enquiry.
  Opportunity history includes notes and stage transitions with loss reasons.
- Staff work on assigned opportunities. Assignment makes that deal's contact and
  optional account visible but does not permit editing their master data or
  expose other contacts at the account. Reassignment revokes derived access when
  no other ownership, enquiry or opportunity grants it. Managers retain tenant-wide
  access. All changes and required audit/history entries share a transaction.
- New models live in CRM. `sales-service.ts` reuses the module's authorization,
  serializable transactions and audit boundary; HTTP routes remain thin adapters.
  Future industry modules should reference opportunities, not repurpose their
  sales stages as bookings, inventory movements or accounting records.

`20260923160000_crm_sales_pipelines` is additive: four new tables and one enum,
tenant RLS, composite foreign keys (including pipeline/stage consistency), and
amount/probability check constraints. The upgrade from milestone 2 was exercised
against disposable PostgreSQL with a non-bypass runtime role. Nine unit tests
and 25 integration tests pass, including race conditions, stale writes, conversion,
permissions, archive behavior, precise money and required-audit rollback.
The production build, TypeScript, targeted ESLint and real authenticated HTTP
workflow also passed. HTTP checks cover pipeline permissions, conversion,
loss-reason validation, optimistic conflicts, filtered lists, notes, disabled CRM,
new page responses and existing appointment page rendering.

On 2026-09-23, the sales-pipeline migration was applied to the configured Supabase
database using `prisma migrate deploy`. All four read-only deployment checks
passed across three CRM migrations, eleven forced-RLS tables and nineteen
validated composite foreign keys. Migration status is up to date and the schema
diff reports no differences. No fixtures or pipelines were added to Supabase.
An administrator enables CRM, then a manager creates a pipeline to start using
opportunities. Application hosting deployment has not been performed.

Forecast dashboards, bulk changes, automated stage actions, custom fields and a
forecasting ledger remain later work. Activities and calendar are covered below.
Visual browser/drag interaction QA is explicitly deferred by the user.

## Milestone 4: staff activities, customer interactions and calendar

The workflow draws on [SugarCRM call management](https://support.sugarai.com/documentation/sugar_versions/25.1/sell/application_guide/calls/),
[Salesforce call logging](https://help.salesforce.com/s/articleView?id=sf.copilot_actions_ref_log_a_call.htm&language=en_US&type=5)
and [Odoo's complete-and-schedule-next pattern](https://www.odoo.com/documentation/14.0/applications/productivity/discuss/overview/plan_activities.html).
It implements an operational staff workspace; it does not claim feature parity
with those products.

- **My Work** (`/crm/activities`) contains tasks, calls, meetings and manually
  logged emails. Filter by personal/accessible work, staff, type, status,
  due date or due reminders. Lists and histories are paginated. Activities have
  their own assignee, priority and instructions, independent of deal ownership.
  Contact, enquiry and opportunity pages embed the relevant activities.
- Schedule all-day work or a timed activity, log something that already happened,
  mark work in progress, cancel with a reason, or complete with an outcome and
  summary. Calls capture direction, actual time and optional duration. The next
  callback can be scheduled in the same transaction as completion; stale or
  concurrent requests cannot create duplicate next follow-ups.
- Staff assigned an open activity can read the customer context and previous
  shared summaries without acquiring access to another salesperson's private
  opportunity fields or notes. Completing/cancelling their last assignment removes
  that derived customer access. They retain their own completed activity record.
  Contact master-data editing still requires contact ownership or management access.
- Completed interaction summaries are shared with staff who currently have access
  to that customer, across the customer's activities. Preparation instructions,
  internal activity notes and deal notes retain their narrower permissions.
  The form labels this distinction. Completed outcomes are retained; corrections
  can be appended as internal notes. Do not place private preparation in a shared
  customer summary.
- Managers can delegate and reassign activities; only the assignee or a manager
  can change one. A deal owner can read delegated work on their deal but cannot
  change another assignee's work unless they are a manager. Reminder snooze/dismiss
  belongs to the assignee. Reassignment and rescheduling reset reminder dismissal.
- **In-app reminders** appear in the CRM banner and My Work. The banner refreshes
  every 60 seconds while visible and when the window regains focus. Snooze for
  15 minutes, one hour or one day, or dismiss without completing the activity.
  There is no background delivery, email, push notification or outbound calling
  in this milestone. Email is an interaction log, not an email-sending feature.
- **Activity calendar** (`/crm/calendar`) reuses installed Syncfusion EJ2 through
  `components/business-calendar.tsx`: day, week, month and agenda, filtered staff
  work, open-activity drag rescheduling and click-to-schedule/detail. The business
  time zone and week-start settings apply; all-day dates remain dates. Timed
  values are stored as instants. Nonexistent or ambiguous daylight-saving local
  times are rejected rather than guessed. Calendar queries are bounded to 62
  days and load at most 500 matching activities, with an explicit truncation
  message directing users to narrow filters or page through My Work.
- Opportunity Kanban cards and list rows show overdue activity counts calculated
  by the server within the user's access scope. Timed work becomes overdue after
  its start; all-day work becomes overdue after its business due date.
- The API lives under `/api/crm/work`, with completion, cancellation, reminder and
  history operations, plus `/api/crm/contacts/:id/interactions`. `work-service.ts`
  reuses the CRM authorization, serializable transaction/retry and required audit
  boundary. Validation, time conversion and UI are separate from persistence.
  The shared calendar component has no CRM or salon persistence dependency.

### Activity upgrade and compatibility

`20260924090000_crm_activity_workspace` extends `CrmTask` so existing follow-ups
remain the same records. It adds an immutable activity-event table, statuses,
assignment, optional opportunity linkage, schedules, summaries and reminders.
The migration runs transactionally and backfills existing contacts, assignees,
completion states and timestamps. Unknown historical authors and summaries stay
unknown. It does not invent calls or import fixtures into the configured database.
Composite foreign keys enforce tenant and parent/customer consistency. A deal
with activities cannot change its contact and move past interactions to another
customer. All new tables force tenant RLS.

Legacy enquiry follow-ups inherit subsequent enquiry assignment until explicitly
edited through the new workspace. New activities keep their explicit staff
assignment when the parent deal/enquiry is reassigned. Database invoker triggers
preserve old application insert/completion/reassignment writes during rollout;
they do not bypass tenant RLS. The legacy task API remains compatible for inherited
follow-ups, and `/crm/tasks` opens My Work.

The upgrade fixture in `tests/fixtures/crm-before-activities.sql` runs only in the
guarded disposable test database. To exercise the upgrade, prepare a schema dump
from the previous milestone, set `CRM_TEST_BASE_SQL` to that dump,
`CRM_TEST_BASE_DATA_SQL` to the fixture, and `CRM_TEST_FROM_MIGRATION` to the activity
migration before running `scripts/prepare-crm-test-db.cjs`. Set
`CRM_TEST_EXPECT_UPGRADE_FIXTURE=1` when running the integration suite.

Next candidates are automatic activity sequences/escalations, background reminder
delivery, recurring meetings/attendees, email/telephony integration, external
calendar sync and activity reporting. Those should extend this activity boundary
with adapters and explicit delivery state, rather than add salon-specific fields
or make opportunity stages perform accounting/inventory operations.

### Verification and rollout

On 2026-09-23, all 53 checks passed: 11 unit tests, 36 disposable-database
integration tests (including a populated legacy upgrade), one authenticated HTTP
workflow, and five read-only checks on the configured Supabase database. The
production build, TypeScript and targeted ESLint also passed. HTTP verification
covers staff call completion, atomic next callbacks, reminders, shared history,
overdue opportunity counts, module access and new page responses. It does not
exercise browser hydration, calendar drag gestures or visual layouts; that QA
remains deferred at the user's request.

The activity migration was applied with `prisma migrate deploy`. All 74 migrations
are current, the Prisma schema diff is empty, and the deployment checks verify
four CRM migration checksums, twelve forced-RLS tables, twenty-seven validated
composite foreign keys and both invoker compatibility triggers. No test fixtures
were added to Supabase. Application hosting deployment has not been performed.

## Milestone 5: activity overview and follow-up coverage

`/crm` now opens `/crm/overview`, with an Overview link in CRM navigation and the
sidebar. This follows the activity reporting pattern documented in
[Salesforce Activity Reports](https://help.salesforce.com/s/articleView?id=analytics.reports_activity.htm&language=en_US&type=5)
and [Odoo's Activities Analysis view](https://github.com/odoo/odoo/blob/19.0/addons/crm/report/crm_activity_report_views.xml).

- Staff see their assigned work. Managers can switch between their own work and
  team reporting, then filter by assignee and activity type. Team reporting is
  checked on the server; owning a deal with delegated activities does not grant
  team-report access. All aggregate and detail queries remain tenant-scoped.
- Current workload includes open, overdue and due-today counts. Completed work
  uses a separate inclusive date period, defaulting to the last 30 business
  calendar dates. The maximum period is 366 dates. Changing the completion period
  does not hide current backlog. Overdue and due-today counts can overlap for timed
  work; they are not additive categories.
- Completions are counted by `completedAt`, the date work was marked complete or
  logged, in the business time zone. They are credited to the activity assignee,
  not the user who clicked Complete. A backdated interaction's `occurredAt` does
  not change when it was recorded in this operational report. Activity-type and
  call-outcome breakdowns use the same selection. Legacy completed tasks count
  without inventing missing outcomes or customer summaries.
- Managers have a paginated staff workload table including zero-work staff and
  inactive assignees with outstanding work. Counts use server aggregates, not
  sums of the first page. Cards and workload counts link to filtered My Work lists;
  completion links preserve the report's business-date period.
- The follow-up gap list shows open opportunities in active pipelines/stages with
  active contacts and **no directly linked open activity**, regardless of activity
  type, date or assignee. A delegated or overdue open activity still provides
  coverage. Completed and cancelled activities do not. Source-enquiry tasks and
  contact-only work do not count as opportunity-specific coverage. The list uses
  the selected deal owner, is paginated by earliest expected close, and offers
  Schedule follow-up. Activity type and completion-period filters do not affect
  this list, as its explanatory text states.
- Read-only APIs are `/api/crm/reports/activities`, `/staff` and `/follow-up-gaps`.
  `report-service.ts` uses the existing CRM membership/module checks and transaction
  boundary. No external messages, automatic reassignment or scheduled jobs run.
- Business-date boundaries handle daylight-saving transitions that skip midnight
  and skipped calendar dates. Calendar date-window queries share the same boundary
  helper; explicit appointment/activity time entry continues to reject ambiguous
  or nonexistent local times.

This milestone uses the existing schema and indexes; no migration is required.
Browser interaction/visual QA and application hosting deployment remain deferred.
Automatic activity plans, escalation rules and background notification delivery
remain separate next milestones.

Verification on 2026-09-23: 59 tests/checks passed (13 unit, 40 disposable-database
integration, one authenticated HTTP workflow and five read-only configured-database
checks). The production build, TypeScript and targeted ESLint passed. HTTP coverage
includes report access restrictions, totals, call outcomes, follow-up gaps,
completion-period drill-through and overview page rendering. All 74 database
migrations remain applied, with no Prisma schema differences. The isolated test
server and disposable database were stopped after verification.

## Milestone 6: reusable activity plans

Activity plans use the launch-date scheduling pattern described in
[Odoo's activity-plan documentation](https://www.odoo.com/documentation/19.0/applications/sales/crm/optimize/utilize_activities.html).
The implementation schedules a reviewed set of activities up front; it is not a
conditional workflow engine or background message sender.

- `/crm/activity-plans` provides searchable, paginated active/archived plans.
  Managers create and edit templates; staff can read and apply them. Templates
  support 1–12 ordered steps with title, type, calendar-day offset (0–365 days),
  priority, instructions, call direction and optional local reminder time.
  Templates are shared configuration visible to CRM staff, so their instructions
  should be reusable guidance rather than private information about a customer.
- Apply a plan from My Work, a contact/enquiry/opportunity's activity list, or the
  plan list. Select the target, start date and responsible staff member, then
  preview all deadlines and reminder times before scheduling. Staff can assign
  only themselves; managers can choose another active member of the business.
  Parent/customer matching and current access are checked again on the server.
  Closed enquiries and won/lost or archived opportunities cannot receive new plans.
- All steps become independent all-day activities at launch, including later-due
  steps. Offsets include weekends and holidays. A reminder, when configured, uses
  the business time zone on that step's due date. Ambiguous/nonexistent DST times
  reject the launch with an explanation. Staff may subsequently schedule a
  specific activity time through the usual activity editor and calendar.
- Generated work uses the existing activity permissions, outcomes, reminders,
  customer history and required audit trail. My Work shows the original plan name
  and step number, supports a launch filter, and activity detail links to the
  accessible activities from the same launch. The filter does not widen access.
- Applying a plan creates its snapshot and all activities atomically. Retries with
  the same request key and payload by the same actor return the same launch.
  Changing a payload with a used key returns a conflict. Separate concurrent
  requests cannot apply the same plan twice to the same target while its prior
  launch still has open/in-progress activities. A plan may be deliberately applied
  again after every prior activity is complete or cancelled.
- Each launch preserves its name, version, input and resolved schedule. Editing
  or archiving a template affects future launches only. Activities remain editable
  through normal staff permissions; completing one does not automatically cancel,
  reschedule or trigger the other steps. Stop unwanted work by cancelling the
  relevant activities, retaining each cancellation reason and history.
- Email steps are manual work items; reminders use the existing in-app delivery.
  There are no outbound messages, telephony actions, automatic stage triggers,
  conditional branches, business-day calendars or per-step assignee overrides.
  Completion-triggered suggestions are added in milestone 7 below. Escalation
  rules and background notifications remain later work.

The additive migration `20260924120000_crm_activity_plans` creates
`CrmActivityPlan` and `CrmPlanLaunch`, plus nullable activity-origin fields.
Existing activities remain unchanged. Both new tables force tenant RLS, composite
foreign keys enforce tenant ownership, and unique keys protect request/step
identity. Template definitions and launch snapshots are bounded JSON validated by
Zod; tasks remain relational records in the existing activity service. HTTP routes
are thin adapters. The bounded multi-step transaction has a 20-second timeout to
allow audited launches over the hosted database connection.

Verification on 2026-09-23: all 66 tests/checks passed (14 unit, 46 database
integration, one authenticated HTTP workflow and five read-only deployment checks).
Coverage includes maximum-size launches, same-key retries, competing requests,
template snapshots, archive/stale-write handling, authorization, tenant RLS,
foreign-key rejection, DST validation and required-audit rollback. The production
build, TypeScript, Prisma validation and targeted ESLint passed.

The plan migration was applied to the configured Supabase database with
`prisma migrate deploy`. All 75 migrations are current and the Prisma schema diff
is empty. Deployment verification covers five CRM migration checksums, fourteen
forced-RLS tables and thirty validated composite foreign keys. No templates or
test fixtures were added to Supabase. The isolated test server and database were
stopped. Application hosting deployment and visual browser testing remain deferred.

## Milestone 7 — reviewed, outcome-based follow-up rules

Managers configure rules at `/crm/follow-up-rules`: completing a particular
activity type with a particular outcome suggests one next activity. For example,
an unanswered call can suggest another call tomorrow with a morning reminder.
This builds on the suggested/triggered next-activity pattern described in
[Odoo's activity documentation](https://www.odoo.com/documentation/19.0/applications/sales/crm/optimize/utilize_activities.html).

- Each business has at most one rule per type/outcome, including archived rules.
  Edit or restore the existing rule to change its trigger. Managers configure;
  CRM staff can read definitions. Configuration is shared guidance and should
  not contain private customer details.
- Rules reuse activity-plan step validation and editor fields: title, activity
  type, priority, instructions, call direction, 0–365 calendar days after
  completion, and optional local reminder time. The next activity keeps the
  current customer, parent record and assignee. Days include weekends and
  holidays. Dates use the business's current local date when completion is
  saved, independently of the recorded interaction's occurrence date.
- The completion form previews the suggestion. Staff choose to create it or
  skip it with a required reason; skipping also permits a manual follow-up.
  A rule and a manual follow-up cannot both run from the same completion.
  Rules create normal all-day work items, including manual email tasks.
  Staff can subsequently edit their times, reminders and other details normally.
- Generated activities record the rule ID, name, version and chain depth.
  Limits of 1–10 consecutive generated activities prevent indefinite retries;
  depth carries across different rules in the same chain. An explicit manual
  activity starts a new chain. Updating or archiving a rule affects future
  completions, including work already open, but does not alter generated work.
- The server rechecks permissions, activity/rule versions, outcome, schedule
  and current related records. Missing or stale reviews return a conflict so
  staff refresh before completing. Closed enquiries, won/lost opportunities,
  archived pipelines/stages/customers and inactive assignees block generation.
  Reaching the chain limit or an ambiguous/nonexistent daylight-saving reminder
  time also blocks generation. Staff may still complete with an audited skip.
  A same-day reminder whose time has passed becomes due immediately.
- Completion, generated work, activity history and required audit entries share
  one transaction. Concurrent requests cannot create duplicate follow-ups.
  Delegated staff retain the customer access needed to continue work without
  gaining access to private parent details. Existing tenant and assignment
  boundaries apply to every generated activity.
- Upfront activity-plan steps do not trigger these rules, avoiding duplicate
  sequences. Logging a past interaction, cancelling work and the legacy quick
  task-completion API also do not trigger them. Legacy completion has no outcome;
  use the activity workspace for reviewed outcome-based follow-ups.

The additive migration `20260924150000_crm_follow_up_rules` adds one forced-RLS
configuration table and four activity-origin fields. Existing activities start
with no rule origin and depth zero. A composite foreign key prevents cross-tenant
origins; database checks enforce complete origin metadata and bounded depth.
No background worker, outbound messaging, stage trigger or escalation engine is
introduced. Background delivery and escalation remain separate future work.

Verification on 2026-09-23: all 75 tests/checks passed (15 unit, 54 database
integration, one authenticated HTTP workflow and five read-only deployment
checks). Coverage includes reviewed completion, concurrent duplicate prevention,
chain limits, manual overrides and skip audits, stale reviews, archived/closed
records, inactive assignees, delegated permissions, tenant RLS, composite foreign
keys, plan/past-log exclusions and complete rollback on required-audit failure.
The incremental migration was exercised over the pre-activity schema and legacy
fixture. Production build, TypeScript, Prisma validation and targeted ESLint passed.

The rule migration was applied to the configured Supabase database using
`prisma migrate deploy`. All 76 migrations are current and the Prisma schema diff
is empty. Read-only verification covers six CRM migration checksums, fifteen
forced-RLS tables and thirty-one validated composite foreign keys. No rules or
test fixtures were added to Supabase. The isolated test server and database were
stopped. Application hosting deployment and visual browser testing remain deferred.

Implementation checkpoints: `a50e1fe` (backend, migration and database tests) and
`1ab763c` (configuration UI, completion review and authenticated HTTP coverage).

## Legacy default tenant retired — 2026-09-27

Businesses are provisioned explicitly. There is no single-business fallback or
default business in the runtime. The platform tenant remains the administrative
control plane and is the only tenant excluded from the business list.

Migration `20260927090000_retire_legacy_default_tenant` removes the historical
`tenant_default` / `default` placeholder only when it has no linked tenant-owned
records. The migration locks the parent row and checks tenant-owned tables with
transaction-local RLS bypass before deleting, preventing accidental cascading
deletion and concurrent creation of foreign-key references. It aborts if data
must first be reviewed or reassigned. Applied historical migrations remain
unchanged; a fresh installation finishes without their obsolete placeholder.
New businesses named `default` have no special handling and appear normally.

Supabase preflight found the legacy tenant empty. The retirement migration was
applied successfully, with all 77 migrations current and no Prisma schema drift.
Three disposable-database tests passed: empty retirement preserves other tenants
and the platform admin, populated retirement rolls back even under a non-bypass
RLS role, and repeat execution preserves an explicitly provisioned business.
All six read-only deployment checks, TypeScript and targeted ESLint passed.
No application hosting deployment was performed.

Run the focused migration tests against the prepared disposable database with
`node --test tests/tenant-cleanup.integration.test.cjs` and the usual guarded
`CRM_TEST_DATABASE_URL` from the CRM testing instructions above.

## CRM interface standardization � 2026-09-28

All CRM lists, editors, reports, calendar controls, plan/rule screens and embedded
sections now share CRM-scoped layout components. Fixed choices use Radix dropdowns,
secondary filters use a common popover, page headers keep save/cancel actions
together, and named sections have consistent cards and spacing. History uses the
shared timeline. Pagination shows record ranges on the left, page controls in the
center and page size on the right, stacking inside narrow sections. These wrappers
do not change the other application modules or the CRM APIs and authorization.

Local verification: 19 unit tests and 11 intercepted browser tests passed. Browser
coverage includes header saves, dependent dropdowns, required-field validation,
activity completion, contact permissions, archive confirmation, account linking,
filter context and pagination. A read-only staging-data preview checked 27 CRM
routes at desktop/mobile widths with no runtime errors or document overflow;
representative light/dark screenshots were inspected. Hosted changes were blocked
in the preview; all mutation tests used intercepted fixtures.

Production build, TypeScript, targeted ESLint and whitespace checks also passed.


## CRM shared record views (2026-09-29)

Extended the project detail/edit-panel pattern across CRM records, activities,
plans, rules, configuration, quotations and templates. See CRM_RECORD_VIEWS.md.
Optional document tabs are selected in application composition; core CRM keeps
its extension boundary. No database migration or permission-policy change.
Local UI verification is separate from hosted acceptance after deployment.


## Default enquiry conversion stage (2026-09-29)

Pipeline configuration now supports one active open default for enquiry
conversion, using the shared edit panel and dropdown. Existing records and
direct opportunity creation retain their behavior. See CRM_CONVERSION_DEFAULT.md
for migration, constraints and local verification. Hosted deployment is pending.


## Platform allowances and tenant module activation (2026-09-30)

Stage 1 adds platform-controlled module allowances above tenant activation for
CRM, Real Estate, Sales Documents and Payment Plans. Shared controls cover
provisioning and existing tenants; server checks, dependencies and required audit
records enforce both layers. Existing activation choices are preserved.
See TENANT_ACCESS_CONTROL.md for migration, verification and remaining role/scope
stages. Changes and both pending migrations are local; not deployed.


## Tenant access Stage 2 (local, 2026-09-30)

Tenant access roles now restrict the existing Staff/Manager account authority across CRM, projects and sales documents. Settings > Access roles provides templates, an action matrix and user assignment; new staff creation supports an initial access role. Typed server requirements cover reads, mutations, exports and generated work, with indexed current-role resolution, forced RLS and transactional audits. Existing users retain legacy access until assigned. The last active tenant administrator is protected. See docs/TENANT_ACCESS_CONTROL.md for configuration, migration and validation details. Not pushed or deployed. Next: indexed own/assigned, managed-team and all-tenant record scopes.


## ERP identity and shared UI foundation (2026-10-03)

Repository renamed to alvinleigia/ls-erp. Neutral presentation components now live in components/erp; CRM adapters preserve authorization and existing workflows. Product branding and tenant-specific invitation/invoice defaults were updated locally. Build, TypeScript, lint, 30 browser regressions and 20 unit checks passed. Legacy module migration remains incremental. See ERP_STANDARDIZATION.md for scope and the pending Vercel Git reconnection, which requires the account GitHub Login Connection. Application changes are not pushed or deployed.

Vercel Git reconnection follow-up (2026-10-03): user reconnected the project; API verification confirms alvinleigia/ls-erp, repository ID 1279282190 and production branch main. The earlier connection blocker is resolved.


## ERP Phase 3 - Inventory module boundary (2026-10-03)

Inventory is independently platform-allowed and tenant-activated, with per-resource access-role checks across APIs, views, stock side effects and dashboard inventory data. A configuration-only migration preserves existing tenant access. Validation used disposable PostgreSQL with enforced RLS and intercepted browser fixtures. See ERP_STANDARDIZATION.md for migration order, configuration, validation, remaining name references and the next Services increment. Not pushed or deployed.


## ERP Phase 2 resumed - Inventory UI adoption (2026-10-03)

Phase sequencing is corrected: extracting shared ERP components did not complete Phase 2. Inventory products, categories, suppliers and purchase orders now adopt shared list layouts, pagination, read-only record panels and separate sectioned draft forms with fixed Save/Cancel actions. Delete and receiving confirmations reuse the same control. Server-backed record pickers replace capped preloads; supplier notes survive unrelated edits. Prior Phase 3 Inventory access work is retained. Services, Appointments, Leaves/Shifts and Dashboard/Reports UI adoption remain in Phase 2; Services is next. See ERP_STANDARDIZATION.md for scope and validation. Changes remain local; not pushed or deployed.


## ERP Phase 2 - Services UI adoption (2026-10-03)

Services, packages and service categories now reuse shared ERP list layouts, read-only record panels, sectioned draft forms, dropdowns, confirmations and pagination. Category and package-service choices search the server rather than preloading only 100 records. Existing tax/pricing, package payloads and access behavior remain in place. Build, TypeScript, targeted lint and four intercepted browser workflows passed; desktop/mobile screenshots were inspected. No hosted mutations, new migrations, push or deployment. Phase 2 continues with Appointments, then Leaves/Shifts and Dashboard/Reports. See ERP_STANDARDIZATION.md.


## ERP Phase 2 - Appointments UI adoption (2026-10-03)

Appointments and coupons now adopt shared ERP layouts, filters, dropdowns, centered pagination, read-only summaries and separate draft panels with fixed actions. Booking summaries use saved pricing/tax snapshots and scheduled times. Shared footers support multiple actions and narrow-screen wrapping; the shared time picker uses dropdowns. Existing booking APIs, stock/pricing rules, invoices and access checks are preserved. Production build, TypeScript, targeted lint and 14 distinct intercepted browser workflows passed across final runs; the new-booking focus-timing test passed three repeats after correction. Desktop/mobile screenshots were inspected. Enabled Syncfusion calendar behavior still needs hosted verification. Existing capped lookup preloads remain a follow-up. No new API/schema changes, hosted mutations, push or deployment. Phase 2 continues with Leaves/Shifts, then Dashboard/Reports. See ERP_STANDARDIZATION.md.


## ERP Phase 2 - Leaves and Shifts UI adoption (2026-10-03)

Leaves definitions/groups/requests/approvals and Shifts templates/schedules/recurring plans/roster now adopt shared ERP layouts, controls, pagination, read-only summaries and separate sectioned drafts. CRM and leave history share the neutral timeline; workflow dialogs keep reviewed actions visible on narrow screens. Existing approval/conflict and scheduling API payloads are preserved. Thirteen intercepted Leaves/Shifts browser workflows and 21 CRM record regressions passed across final runs; desktop/mobile screenshots were inspected. Targeted ESLint passed. See ERP_STANDARDIZATION.md for build verification and retained lookup/calendar limitations. No new API/schema changes, hosted mutations, push or deployment. Phase 2 continues with Dashboard/Reports before further Phase 3 access expansion.

Leaves/Shifts final verification: production Next.js build and standalone TypeScript exited 0; targeted ESLint and whitespace checks passed. All 13 Leaves/Shifts browser checks passed together in the final run. Changes remain local.


## ERP Phase 2 - Dashboard and Reports UI adoption (2026-10-03)

Dashboard, Coupon usage and Audit logs now reuse shared ERP headers, sections, filters, dropdowns, pagination and read-only detail panels. Complete custom date ranges, refresh/loading/errors and cancelled obsolete requests preserve clear report state. Existing calculations, report role guards and server pagination remain intact. Production build, targeted lint and four intercepted browser workflows passed; chart animation settling was checked in a follow-up run and desktop/mobile screenshots were inspected. No new API/schema changes, migrations, hosted mutations, push or deployment. The named Phase 2 UI adoption increments are now complete locally; capped lookup and hosted Syncfusion/acceptance checks remain follow-ups. Next is Phase 3 Services/module activation and access expansion. See ERP_STANDARDIZATION.md for scope and limitations.


## ERP Phase 3 - Services activation and access (2026-10-04)

Services resumes Phase 3 after local Phase 2 UI adoption. Services/catalog categories now use platform allowances, tenant activation, resource/action permissions and current-user tenant-scoped API guards; legacy ADMIN/MANAGER ceilings remain. Booking catalog use, staff eligibility, maintenance and dashboard catalog counts respect the module boundary. Saved bookings/invoice PDFs remain readable. Migration 20261003100000_services_module preserves existing tenant access and explicit decisions; apply after the pending Inventory migration before rollout. Build, TypeScript, targeted lint, ten real-RLS integration/migration checks and twelve browser workflows passed; screenshots were inspected. Inventory/module/access/Users/Dashboard regression checks passed across runs. Catalog audits retain the existing best-effort policy; eligibility changes are transactionally audited. See ERP_STANDARDIZATION.md for dependencies, fixes and limitations. Changes and migrations remain local, not pushed or deployed. Next: Appointments activation/access.


## ERP Phase 3 - Appointments activation and access (2026-10-04)

Appointments now has independent platform/tenant activation, booking and coupon
resource permissions, current-user API boundaries, guarded navigation/pages and
permission-aware controls. Service booking changes require Services/read; product
lines require Inventory/read; saved history remains available with Services off.
Cancel/reactivate requires Archive, PDF export requires Export, and email also
requires Edit. Dashboard, coupon reports, appointment/coupon audit snapshots,
maintenance and leave/shift conflict detail responses respect the boundary.
Migration 20261004090000_appointments_module preserves existing tenant access and
explicit decisions; apply after pending Inventory/Services migrations at rollout.
Nine real-RLS integration/migration checks, 25 related integration regressions,
four access/navigation checks and 16 browser workflows passed. Desktop/mobile
screenshots were inspected. See ERP_STANDARDIZATION.md for audit/dependency and
calendar/lookup limitations. No push, deployment or hosted migrations performed.
Next: Phase 3 Leaves/Shifts activation/access.

Appointments final verification: production Next.js build exited 0; standalone TypeScript, targeted ESLint and whitespace checks passed. The disposable local test database container was stopped. Changes remain local.


### Phase 3 - Leaves/Shifts boundaries (2026-10-04)

Leaves/Shifts now use platform allowance and tenant activation, independent of CRM
and each other. Current-user API guards enforce resource actions, personal-request
ownership and direct-report approval limits; page/navigation/action controls match.
Definition/group and template/schedule/plan/roster operations are separately
permissioned. Replacement recurring plans require Archive; staff profile scheduling
mode changes cannot bypass the Shifts switch. Existing saved availability remains
in force for bookings when module screens are disabled. Workforce audits, dashboard
counts and maintenance respect access. See ERP_STANDARDIZATION.md for exact audit,
lookup and partial-roster behavior.
Migration 20261004100000_workforce_modules preserves existing access; future tenants
require allowance. Ten workforce database/RLS/migration tests, 34 related integration
tests and 36 intercepted browser checks pass. Desktop/mobile screenshots inspected.
All changes and pending migrations remain local. Next: remaining Dashboard/Reports,
Users and Settings access boundaries, then separately planned record-scope work.

Workforce final verification: production Next.js build exited 0; targeted ESLint and whitespace checks passed, alongside the four access-policy/navigation tests. Local database tests and browser harness used isolated/mocked data only. No push, deployment or hosted migrations.


### Phase 3 - Core administration boundaries (2026-10-04)

Dashboard, audit reports, user directory, business settings and tax configuration
now have separate access-role permissions. These are shared core capabilities,
not tenant-disableable modules; tenant administrators retain full access. Existing
custom roles need the appropriate new read permissions explicitly granted.
User creation, invitations, role/security changes and staff administration remain
administrator-only. Active staff, managers and customers retain basic self-profile
access without directory access. Current database account/tenant state overrides
stale session role claims on these APIs and business layouts.

Shared core guards, route requirements, navigation filtering and action controls
are reused. Settings and user-detail GET requests no longer create configuration
or staff rows. Business settings and tax writes record before/after audit snapshots;
invitation audits exclude tokens. Tax activation/deletion requires Archive in
addition to Read; Edit alone cannot change status.

Booking/workforce forms use paginated, tenant-scoped directory projections;
catalog/booking forms use a tax lookup; scheduling uses operational settings and
other screens use display preferences. These avoid granting full Users/Settings
access just to fill a dropdown. Existing 100-row client lookup caps remain a
separate follow-up. The audit report applies source permissions/module activation
before count and pagination. Managers see recognized authorized operational
resource events only; security, CRM, unrecognized events and scoped leave-request
snapshots remain excluded from that generic report. Relevant record timelines
remain the place for scoped history. Dashboard staff counts require Users Read.

Validation: 46 core/workforce/appointments/services/inventory database tests pass
(44 initially, two legacy dashboard fixtures updated for the new Dashboard Read
permission and rerun within 21 passing inventory/services tests). An additional
18 Users/Settings tests, four Dashboard tests, six access-role integration tests
and four policy/navigation tests pass. All 34 selected intercepted browser checks
pass (33 initially; one form-navigation timeout passed on isolated rerun).
Read-only Settings and restricted tax-editor screenshots inspected. Targeted
ESLint passes. No live email, hosted data changes, commit, push or deployment.
No new migration is required for this increment; earlier module migrations remain
local. Next: separately planned record-scope expansion in TENANT_ACCESS_CONTROL.md.

Core final verification: production Next.js build exited 0 after retrying a transient Google Fonts connection failure. Build TypeScript and prerendering passed; targeted ESLint and whitespace checks passed. The disposable local test database was stopped.


## Phase 3 - CRM sales record scopes implemented locally (2026-10-04)

Settings > Access roles now includes CRM sales record scope: Existing account
access, Own / assigned records, Own and managed sales teams, or All tenant records.
Existing roles retain account-based behavior. Tenant ADMIN remains tenant-wide;
STAFF remains within assigned-record access even if a broader scope is selected.
Manager accounts can be narrowed through the role. Action permissions still apply.

In CRM > Configuration > Sales teams > Members, a tenant administrator can set
Team access to Team manager for an active Manager account. Ordinary membership
does not grant authority. A managed scope covers records explicitly assigned to
that sales team, plus the manager's own records; it does not expose every record
owned by a member. Role changes, manager revocation and team archival take effect
on subsequent requests without another login. Changes are versioned and audited.

Shared predicates cover enquiries, opportunities, related contacts/accounts,
activities/internal history, quotations/PDF access, selectors, counts, reports and
exports before pagination/aggregation. Parent/referral labels remain masked when
outside the scope. Existing customer-facing completed interaction summaries stay
shared for an accessible contact; private work details/history remain scoped.
Edits retain the record owner and audit the actual manager. Former team members'
visible activities remain attributed in reports; existing assignments may be
preserved on edit, but new assignments still require an allowed active assignee.
Project access, configuration permissions and other ERP module record scopes are
unchanged by this sales-specific setting.

Migration 20261004110000_crm_record_scopes adds TenantAccessRole.crmRecordScope
(default ACCOUNT_ROLE, checked values) and CrmSalesTeamMember.isManager (false).
It rewrites no ownership and promotes no existing members. Apply this and the
pending earlier module migrations BEFORE deploying code that selects these
columns. Only the disposable local database has received this migration.

Validation: 126 database tests passed, including the new scope/migration suite,
CRM, teams, sales reporting, quotations, roles and core boundaries. Two existing
legacy migration checks remain skipped (activity upgrade and lead-source intake).
One contention failure in the parallel run passed in isolation; the complete
serial rerun passed. Thirty unit/policy checks and five intercepted browser checks
passed. Role desktop/mobile and team-manager screenshots inspected. The managed
scope returns five of 10,000 records in 13 SQL statements; authorization is loaded
once per operation, with no per-row permission queries. Production build and
TypeScript passed; targeted ESLint and whitespace checks passed.

Run the new suite with npm.cmd run test:crm:scopes:integration, using only the
local CRM_TEST_DATABASE_URL described in the test guard. No hosted writes,
commit, push or deployment. Next: the separately planned audit-review and rollout
increment; this milestone does not claim additional ERP record scopes are done.


## Phase 3 - protected audit review implemented locally (2026-10-04)

This completes the audit-review portion of access-control Stage 4; hosted rollout
remains pending. Reports > Audit logs now provides All permitted / Business /
Security event filters, exact actor and record IDs, request ID, entity type,
validated UTC date bounds and search. Standard server pagination and shared
read-only panels remain in use. View shows actor, target, timestamp, request ID
and a field-by-field Before/After comparison. Recorded snapshots are expandable.
Partial audit patches do not imply that omitted fields were deleted.

The list selects summaries only. A separate detail GET repeats current access
checks and returns recursively redacted credential fields, leaving stored audit
rows unchanged. Reload/focus clears previous details while rechecking access;
denied requests cannot fall back to the old snapshot. Neither endpoint mutates
business data. Current actor permissions, module flags, count and rows use one
repeatable-read database transaction for a consistent authorization snapshot.

Tenant administrators can review security changes, including access roles,
assignments, team-manager designations and module allowances/activation. Managers
require Audit reports Read plus the underlying operational resource Read and
module activation. They receive only the previously supported operational event
families. Generic CRM/security/unknown audit snapshots remain excluded for
managers regardless of CRM record scope; the existing scoped CRM record timelines
remain available. Disabled modules hide domain audit payloads from administrators
too, while security changes remain reviewable. Historical saved payment schedules
retain the established Sales Documents contract.

Migration 20261004120000_audit_review_indexes adds tenant/date, tenant/actor/date
and tenant/entity/record/date indexes without rewriting rows or changing RLS.
Only the disposable local database received it. Pending local deployment order:
20261003090000_inventory_module, 20261003100000_services_module,
20261004090000_appointments_module, 20261004100000_workforce_modules,
20261004110000_crm_record_scopes, 20261004120000_audit_review_indexes.
Verify hosted migration history before applying; earlier existing migrations may
also be pending. Do not deploy the record-scope queries before their columns exist.

Validation: 19 audit/core API, migration and formatting checks plus 33 appointment,
workforce, role and CRM-scope regressions passed. Five intercepted browser tests
passed, with the two audit cases rerun after fixing screenshot animation timing.
Desktop/mobile audit screenshots inspected. A 10,000-event service list uses six
SQL statements for five summaries and does not select snapshot columns; EXPLAIN
confirms the record-history index. Production build/TypeScript, targeted ESLint
and whitespace checks passed. The local database was stopped after verification.
Run npm.cmd run test:audit:integration against the guarded disposable database.
No commit, push, deployment or hosted data changes were made.

Next: deployment-readiness review of the accumulated local changes and pending
migrations, followed by hosted verification only when deployment is requested.


## Local deployment-readiness review (2026-10-04)

Phase 3 local release checks completed. See ERP_STANDARDIZATION.md, Phase 3
deployment-readiness review, for migration order, validation evidence, existing
warning/skip limits and the deployment procedure. All 96 migrations were rehearsed
on a fresh local database, including the six pending migrations over populated
fixtures; build and 112 local UI tests passed. Nothing was committed, pushed or
deployed. Hosted migration state and end-to-end verification remain pending.


## Phase 3 commit checkpoint (2026-10-04)

The reviewed ERP interface/access changes and six migrations are consolidated for
the user-authorized local commit. Validation evidence and deployment order are in
ERP_STANDARDIZATION.md. Nothing is pushed or deployed at this checkpoint.

## Phase 4 - real local access verification (2026-10-04)

Ten real browser/API access scenarios passed against the production Next build
and disposable PostgreSQL using the non-bypass runtime role. Coverage includes
platform/tenant module controls, dependencies, CRM manager/team scopes, staff
ceilings, live permission revocation, concurrent edits, tenant isolation and
redacted audit detail. A suspended-account redirect loop was fixed and verified,
including recovery to a usable sign-in form and wrong-tenant session clearing.

Audit review and this local verification are complete; hosted rollout and broader
business-workflow verification remain pending. No push/deploy or hosted writes.
See ERP_STANDARDIZATION.md and BROWSER_TESTING.md for evidence and rerun steps.
## Phase 4 - local sales and ERP workflows (2026-10-04)

All 19 real local browser/API scenarios passed (ten access, five sales, four ERP).
Sales covers project-linked enquiry conversion, site visits and follow-ups,
quotation/payment schedule revisions and PDF, won close and spam filtering.
ERP covers services/shifts, purchase receipts, booking stock changes and rollback,
cancellation, invoice PDF and leave approval affecting availability. A booking
PATCH bug that cleared omitted products/coupons was fixed without schema changes.
The production build and 20 booking/inventory integration checks also passed.
See ERP_STANDARDIZATION.md for details and limitations. Next local cleanup:
tenant-consistent Leaves date/time display. Hosted rollout remains pending;
no push, deployment or hosted writes.
## Phase 4 - Leaves timezone verification (2026-10-04)

Leaves display now uses tenant date/time settings and shared neutral helpers also
used by CRM history. Date-only leave records do not shift in western browser
zones. Appointment conflict rescheduling converts tenant wall time to UTC and
validates daylight-saving ambiguity; preview, persisted time and audit timezone
agree. No new migration. Build, targeted lint, six date tests, 17 existing
appointment/workforce integration checks and five focused real ERP scenarios pass.
Together with the access/sales results, all 20 local scenarios are verified across
runs. See ERP_STANDARDIZATION.md for evidence and limitations. Local release review
is next; nothing is pushed/deployed and hosted verification remains pending.
## Phase 4 - release readiness checkpoint (2026-10-04)

Local implementation/verification is consolidated for commit. See
[RELEASE_READINESS.md](RELEASE_READINESS.md) for the current release scope,
verification evidence, remaining hosted checks, migration order and recovery.
Nine local read-only deployment checks passed again; lint has zero errors and
four existing warnings. No new schema change or hosted operation. Keep push and
deployment on hold under the user's instruction; migrate the target before a
push that may trigger automatic deployment.