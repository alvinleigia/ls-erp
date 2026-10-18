# Industry-neutral refactor: R4 delivery notes

Scope: complete the remaining Real Estate composition boundaries and prepare the
single release migration/reconciliation package. All work is local. R5 retains
the protected backup, restore rehearsal, production reconciliation and cutover.

## Batch 1 - activity embedding and neutral document presentation (2026-10-18)

- Shared WorkList accepts a code-owned extension query, optional guidance and
  creation-action visibility. It no longer knows project IDs, subproject IDs or
  site-visit instructions. Its pagination, search, status, owner and date filters
  remain shared; core list controls take precedence over supplied query values.
- Real Estate's ProjectActivities owns parent/child query construction, site-visit
  guidance and hiding direct creation actions. It reuses WorkList, remounts for a
  different project context and does not mount the list without module/access
  permission. Changing terminology does not change the query or refetch records.
  The server remains authoritative for project visibility and module checks.
- Sales Documents displays provider-supplied context under Linked records, without
  assuming it always describes a project. Business name, registration reference,
  additional details and pricing guidance are neutral. Existing RERA values,
  property references, document content and saved context remain supported.
  No schema, persisted field, URL, calculation or snapshot format changed.

Verification: 54 unit/database checks and six distinct local browser flows passed.
Two historical migration checks remain deferred to R5. Production build/TypeScript
(135 pages), targeted lint and whitespace checks passed. Tests cover parent/child
activity scope, ordinary CRM actions, no work-list reload on terminology changes,
module-off UI/API behavior, no property-context query when disabled and immutable
saved quotations. Existing terminology/document flows also passed.

Visual review covered the mobile project activity list and desktop quotation
editor. It found pre-existing garbled ellipses/separators in WorkList; these were
corrected in code-owned display text only. The build and two affected browser
flows were rerun afterward, including exact punctuation assertions and mobile
overflow checks. No saved content was rewritten.

Evidence: tmp/r4b1-checks.log, tmp/r4b1-build-final.log,
tmp/r4b1-lint.log, tmp/r4b1-lint-final.log, tmp/r4b1-browser.log,
tmp/r4b1-browser-final.log, tests/local-access/industry-views.spec.ts and
tests/crm-extensions.test.cjs. No hosted query, migration, client-data change,
commit, push or deployment. Disposable local database stopped after verification.

## Batch 2 - enquiry/opportunity context and activation (2026-10-18)

- Enquiry lists and opportunity lists/boards serialize industry filters through
  the same extension mapping already used by sales reports. Shared controllers
  retain neutral reference state; Real Estate owns project/subproject query keys.
  CSV export uses the same query as the list. Reset keeps a fixed embedded context
  and clears optional selections; changing the parent clears the child.
- Application creation pages delegate URL interpretation to Real Estate and pass
  neutral references to the shared editors. Existing projectId/subprojectId links
  remain valid; repeated/non-string values are not treated as record identifiers.
  There is no compatibility editor branch, duplicated form or extra database read.
- Extension activation gates filters, captions, fields, summaries and new write
  payloads. Hidden filters no longer reach list/report/export requests. Existing
  record associations remain untouched by core-only edits while the addon is off.
- Editor loading depends on the extension's stable load function, not unrelated
  document-panel availability. The shared module provider refreshes its snapshot
  in place instead of temporarily unmounting every guarded view. Initial access
  still waits for loading; failed refreshes and revoked permissions deny the view.
  APIs remain authoritative during pending refreshes. Tenant/user/role changes
  still remount the keyed provider, so no cross-session snapshot is reused.

Verification: 53 unit/database checks passed; two historical migration fixtures
remain deferred to R5. Production build/TypeScript (135 pages), targeted lint and
whitespace checks passed. All 24 distinct browser flows passed across the final
run and rechecks. The broader run had 23 passes and one tenant-switch sign-out
failure; that unchanged test passed in isolation and the complete ten-test access
suite then passed together. Keep that initial intermittent failure in release
evidence; no authentication code was changed to make it pass.

The first browser attempt exposed the module-refresh draft loss fixed above and
two popover-transition test races. The four new flows passed after correction;
filter tests were also rerun with explicit open-state assertions and animation-free
screenshots. Enquiry/opportunity module-off filter layouts were visually inspected.
Covered: dependent selections, fixed-context reset, matching CSV filters, stable
terminology refresh, URL defaults, core-only saves preserving stored project links,
pending/failed access refresh and existing tenant/role/module isolation.
The disposable local database was stopped after verification. No schema or stored-data migration, hosted query, client-data change,
commit, push or deployment.

Evidence: tmp/r4b2-checks.log, tmp/r4b2-build-final.log, tmp/r4b2-lint.log,
tmp/r4b2-lint-final.log, tmp/r4b2-browser-lint-final.log,
tmp/r4b2-browser.log, tmp/r4b2-browser-final.log, tmp/r4b2-browser-recheck.log,
tmp/r4b2-access-recheck.log and tmp/r4b2-filters-final.log;
tests/local-access/industry-sales-views.spec.ts and tests/crm-extensions.test.cjs.

## Batch 3 - configuration and shared export controls (2026-10-18)

- Registered field resources own scope labels and whether their context permits
  a sales team. The configuration API returns metadata for enabled resources;
  the common screen resolves terminology without PROJECT or Real Estate branches.
  Shared scopes require consistent labels as well as matching ownership/policy.
- Scope codes, field identifiers, validation, required cohorts, saved values and
  audit behaviour are unchanged. Selecting a business-wide scope clears the team;
  the existing owning server policy still rejects invalid team assignments.
  Metadata comes from code-owned registration and adds no industry-table reads.
- One shared CSV control now requires explicit access requirements from each
  caller. Enquiries, opportunities, projects and report drilldowns reuse it.
  Reports require both report-export and the selected record's export permission.
  URL guessing and the old CRM-specific export component have been removed.
  Endpoints continue enforcing current permissions independently of UI visibility.

Verification: 40 unit/database checks and all 11 selected local browser flows
passed. Production compilation, TypeScript and all 135 pages completed; the
PowerShell wrapper reported a NativeCommandError for Prisma's informational
stderr despite completed build output. Browser checks used that production build.
Targeted lint and whitespace checks passed. Desktop field configuration and mobile
configuration-draft screenshots were visually inspected.

Covered: module-off scope availability, rejection of disabled writes and invalid
teams, preserved field identity/version after re-enabling, terminology refresh
without draft loss, per-record export permission, report/record permission
intersection, project CSV download, existing filter/export matching and access
refresh behaviour. Historical migration/restore evidence remains in R5.

Evidence: tmp/r4b3-build.log, tmp/r4b3-checks.log, tmp/r4b3-lint.log,
tmp/r4b3-browser-lint.log, tmp/r4b3-browser.log and tests/local-access/industry-configuration.spec.ts.
No schema change, hosted query, client-data change, commit, push or deployment.
Disposable local database stopped after verification.

## Batch 4 - provider and permission audit (2026-10-18)

- Fixed a project-browsing gap in import metadata. Custom roles without
  projects.read receive no project/subproject mapping choices, and no project
  catalog query runs. Other enabled buyer-requirement fields remain available.
- New or changed project selections also require projects.read at the server
  write boundary. Direct submissions cannot bypass the import/form restriction.
  Revocation after import review rejects affected rows without creating contacts.
  Existing accessible CRM context remains readable; core-only edits retain links.
- General sales preset definitions/builders now belong to CRM and property
  categories/preset definitions to Real Estate. Application code only composes
  them. IDs, versions, item keys, descriptions and deterministic identities are
  unchanged; applying a preset still preserves renamed/archived choices.

Audited boundaries:

| Provider | Activation and access behaviour | Evidence |
| --- | --- | --- |
| Presets | CRM boundary plus preset activation; resource read before inspection, create permission before creation; tenant-scoped atomic writes/audit | preset-boundaries.test.cjs, crm-teams.integration.test.cjs |
| Reports | Disabled addon omits joins/columns/grouping; explicit inactive filters rejected; scoped CRM rows and record/report export permissions remain authoritative | crm-extensions.test.cjs, crm-sales.integration.test.cjs |
| Dashboards | Activation, dependencies and permissions checked before widget queries; bounded scoped rows; current quotation revision prevents schedule double counts | crm-extensions.test.cjs, dashboard.integration.test.cjs, dashboard-modules.spec.ts |
| Import | Inactive addon skips its lookup queries; project choices obey browse permission; commit rechecks access and isolates rejected rows | crm-extensions.test.cjs, crm-import.integration.test.cjs, enquiry-import.spec.ts |
| Documents | Accessible opportunity resolved before live context; inactive addon supplies none; historical snapshots remain immutable; schedule changes require Payment Plans | quotations.integration.test.cjs, industry-views.spec.ts |

Linked context on an already accessible sales record is read-only evidence, not
permission to browse its project. The deliberate conversion copy preserves an
existing association inside the authorized conversion transaction even when the
addon is off; this is distinct from loading live addon choices or reports.

Verification: 80 unit/database checks passed (78 in the combined run and two
preset boundary checks); no skips in this run. Build/TypeScript and 135 pages
completed with exit 0. Targeted lint and whitespace checks passed. Four distinct
local browser flows passed; dashboard was rerun successfully after strengthening
its wait for the summary response. Initial screenshot review caught a loading
state despite passing assertions. The corrected dashboard screenshot and mobile
import mapping screenshot were inspected. No production UI workaround was added.

Evidence: tmp/r4b4-build.log, tmp/r4b4-checks.log, tmp/r4b4-presets.log,
tmp/r4b4-lint.log, tmp/r4b4-browser.log, tmp/r4b4-dashboard-recheck.log;
tests/preset-boundaries.test.cjs and the suites listed above.
No application schema change, hosted query, client-data change, commit, push or
deployment. Database tests used isolated local fixtures; the disposable container
was stopped afterwards. Actual client migration/restore evidence remains R5 work.

## Batch 5 - release manifest and reconciliation package (2026-10-18)

R4 implementation/preparation is complete locally. The protected client inventory,
backup, restore rehearsal, full release gates and cutover remain R5 requirements.
See [release procedure](INDUSTRY_NEUTRAL_RELEASE.md) and
[manifest](industry-release-manifest.json).

- Manifest pins 99 migration files (97 baseline, two release), Prisma schema,
  required baseline table names and the exact allowed new table/index contracts.
  Historical SQL matches source baseline 5f13238. The actual hosted baseline has
  not been inspected or assumed to match it.
- Read-only local capture streams rows in batches of 500 within a consistent
  transaction, recording per-tenant counts, identity/content hashes, table security,
  constraints, indexes, enum/isolation-function definitions, FK violations,
  migration history and exact stored sales/document totals. No raw records are
  written. Comparisons reject unexpected changes and incomplete baselines.
- The pending terminology SQL is now transactional; a conflicting second table
  rolls back the first. This is a change to an unreleased local migration, not to
  production history. The shift-index migration remains transactional and does
  not rewrite records.
- The tool cannot connect to hosted databases, load dotenv, apply migrations,
  overwrite snapshots, repair data or deploy. Reports stay in ignored local tmp
  storage and require appropriate OS protection. R5 separately verifies baseline
  schema drift, runtime access, grants, assets, integrations and restore completeness.

Verification: five tests passed with no skips, using 1,201 representative fixture
rows over two tenants, synthetic migration history and the actual two release SQL
files. Tested decimal mutation, replaced IDs, tenant moves, changed snapshots,
security/schema drift, orphans, bad history, migration rollback, repeated capture
stability and restricted-reader rejection. The reduced fixture fails the full
103-table baseline gate as expected; it is not an actual client upgrade rehearsal.
Source-only verification and targeted lint/whitespace passed. No application
runtime/UI changed; no build/browser rerun is claimed for this tooling batch.

Evidence: tmp/r4b5-checks-final.log, tmp/r4b5-lint.log and
tmp/r4b5-whitespace.log; tests/industry-release.test.cjs and
tests/industry-release.integration.test.cjs. Disposable fixture databases were
removed and the local container stopped. No hosted query, client-data change,
commit, push or deployment.

## Next - R5 protected rehearsal

Confirm the real application/database target and migration state, protect and
restore the client's backup, then execute the release procedure on that isolated
copy. Previously deferred historical upgrade fixtures and full release checks
remain explicit gates. R4 completion does not authorize or certify cutover.
