# Odoo alignment Phase 4: sales teams and workflow configuration

Implemented locally on 2026-09-29. Not deployed; no hosted migrations or business
records were changed. This is the fourth phase of CRM_ODOO_ALIGNMENT_PLAN.md.

## Configuration and use

- `CRM > Configuration > Sales teams`: create/edit/archive a team, select its
  workflow and add/remove active salespeople. Membership has server-side search
  and pagination. Save team edits before changing membership.
- **Qualify enquiries first**: a new opportunity in this team must come from an
  enquiry marked QUALIFIED. Both API and form saves enforce this requirement.
- **Direct opportunities**: create opportunities directly; new enquiry intake is
  rejected for this team. Existing enquiries remain editable and convertible
  after a workflow change; the workflow does not rewrite old records.
- Enquiry/opportunity editors select a team and filter assignee choices to its
  members. Conversion retains the enquiry's team. Once converted, the source
  enquiry keeps its original team; managers can subsequently transfer the deal.
- Existing records and new records with no team retain the previous workflow.
  No teams, members, fields or defaults are assigned implicitly on migration.
- Enquiry lists, opportunity lists/boards, CSV exports and Sales reports support a
  sales-team filter. Managers can include archived teams for historical reporting.
  Report summary, breakdown, drilldown and CSV use the same scoped predicate.

## Permissions and history

Team membership is an assignment boundary, not permission to browse colleagues'
records. Staff retain their existing own-record scopes; managers retain business-
wide CRM access. Only managers configure membership or transfer records between
teams. A new assignment requires an active user and active team membership.
Joining a team never grants contact, account or Real Estate project access.

Managers must reassign a member's open unconverted enquiries and open deals before
removing them. Historical assignments survive removal, archive and workflow
changes. Archived teams remain readable on authorized records; new assignments
are blocked. Unchanged historical ownership permits ordinary edits.

Team edits/membership changes use versions, serializable retries and required
transactional audit. Concurrent creation/removal cannot strand an open record
with a removed member. Conversion preserves its existing idempotency contract.

## Team-specific additional fields

`CRM > Configuration > Custom fields` now optionally selects a Sales team for
Enquiries, Opportunities or the shared Enquiries and opportunities scope. Project
fields remain business-wide. Scope/team/type/code are immutable after creation.
The existing 50-field limit per applicable record type (including archived and
team-specific definitions) still applies, and field codes stay unique per tenant
and record scope. Teams do not multiply that limit.

A record displays and validates global fields plus its current team's fields.
Shared fields copy during conversion with saved labels and provenance. Transfers
retain former-team values in storage but exclude them from forms, filters and
exports until the record returns to that team. Team selection refreshes the form
and discards inapplicable unsaved values. Restricted/default/required rules and
record-level authorization continue to use the common field engine.

## Explicit presets

`CRM > Configuration > Configuration presets` offers General sales and, when its
module is enabled, Real Estate sales. Preview lists each setting as Add or Keep
existing. Apply requires the matching preview token; a changed configuration
requires another preview. All additions and audits commit or roll back together.

General sales supplies Referral/Website sources, an optional Purchase requirements
shared field and a Proposal review task type. Real Estate supplies Property portal/
Channel partner sources, Plot/Apartment categories, an optional Preferred locality
shared field and a Site Visit meeting type. These are starter choices, not a new
industry module or a claim of complete Odoo parity.

Stable item IDs and existing codes/names preserve renamed, archived or customized
settings. A later preset version can add missing items but never overwrite them.
Applying a preset does not alter pipelines, teams, defaults, existing leads or
permissions. Industry recipes are registered in application composition; core CRM
has no Real Estate imports. No custom scripts or automatic outbound actions run.

## Migration and recovery

`20260929160000_crm_sales_teams` adds two forced-RLS tables with composite tenant
foreign keys, nullable team links on enquiries/opportunities/field definitions,
indexes, and workflow/scope constraints. Existing IDs, dates, versions, owners,
links and custom values are untouched; no data backfill is required.

Before release, back up the target DB and reconcile the existing CRM Test baseline.
Apply and verify the pending Phase 1-3 releases before releasing this phase. Then
apply the additive team migration, deploy, and check admin/staff access, membership,
conversion, filtered reports and presets against existing synthetic test records.
Do not reset/seed the hosted database. Rollback must retain team/field data; older
application versions do not enforce team workflow rules, so suspend team-related
writes during rollback rather than assuming an old UI enforces new configuration.

## Verification

- Fresh-schema preparation and actual upgrade from the Phase 3 schema were checked
  on separate disposable local PostgreSQL databases. Existing enquiry owner,
  contact, version and custom value were preserved. Prisma schema drift was empty.
- 11 sales-team integration scenarios passed: manager/staff permissions, tenant
  RLS/FKs, membership, active assignees, qualification/direct modes, legacy mode,
  conversion, team field transfer, archive, reports/exports, presets, stale reviews,
  concurrent edits/removal/conversion, audit rollback and indexed pagination.
- On 10,000 enquiry rows, selecting a team with 100 matches returned a five-row
  page with 13 statements, 26 ms service time and 0.040 ms indexed SQL locally.
  A repeat during build verification measured 65 ms / 0.082 ms with the same
  query count. These are local measurements, not production performance guarantees.
- Existing regressions: 25 unit/boundary tests; custom fields 10; core CRM 70
  (2 historical-fixture checks skipped); sales reports 9; Real Estate 23
  (2 historical-fixture checks skipped). Integration files run individually with
  --test-force-exit because the older runner retains a handle after assertions.
- Local browser coverage: team configuration/member assignment, qualification and
  conversion, preset preview/apply/mobile layout, team-scoped field switching,
  existing configuration, custom fields, project sales and module-off editing.
- TypeScript, targeted ESLint, whitespace checks and the production build passed.
  Desktop and mobile screenshots were inspected, including loaded team lists,
  centered pagination, team fields and the preset preview.
- Hosted read-only checks: 12 existing admin/staff workflow/layout checks passed,
  plus the saved record-baseline comparison. The staff snapshot case is intentionally
  skipped. Initial network access was sandbox-blocked; a capture attempt refused
  to overwrite the existing baseline, so the final check compared it instead.

Payments, quotations/payment-plan PDFs, receipts and accounting remain outside
this phase. The agreed next feature is a reusable quotation/payment-plan document
linked to opportunities, with Real Estate-specific details supplied by its module.
