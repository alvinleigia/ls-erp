# CRM and sales Phase 1: baseline and implementation contracts

Date: 2026-09-28. Engineering baseline and mapping complete. No production schema
or application behavior changed in this phase. Subsequent Phase 2 implementation
is recorded separately in [the Phase 2 delivery notes](CRM_SALES_PHASE_2.md).

This document implements Phase 1 of [the active delivery plan](CRM_EXTENSIBILITY_PLAN.md).
The [screenshot review](EWISSEN_CRM_GAP_REVIEW.md) records the underlying evidence;
its older phase numbering is superseded by the active plan. Screenshots establish
visible business tasks, not the client's complete requirements or backend rules.
The decisions below are implementation defaults, not invented client sign-off.

## Workflow coverage and acceptance map

L1-L4 and B1-B2 refer to the evidence identifiers in the screenshot review.
"Existing" describes the current source and regression baseline. Future acceptance
scenarios are requirements to test in their delivery phase, not tests already passed.

| ID / business outcome | Reuse now | Remaining work and phase | Acceptance / intended added value |
|---|---|---|---|
| S01 Identify the buyer (L1-L3) | Contacts, normalized primary email/phone, tenant uniqueness, restricted lookup | Additional contact details and existing/new-contact intake, P2 | Reuse a visible customer for a second enquiry without creating a second contact; preserve a draft when a duplicate is detected; never reveal a hidden match. |
| S02 Capture the sales enquiry (L1-L3) | Title, requirements, contact, assigned salesperson, free-text source | Managed sources, enquiry company context, referral and target close, P2 | Staff can capture actionable interest with optional detail; historical sources still display after retirement. |
| S03 Find and hand over work (L2-L3) | Server pagination, assigned visibility, manager reassignment, audit, shared summaries | Phone/company search, source/owner filters, clearer metadata, P2 | A new assignee can continue the enquiry; the previous assignee loses derived access unless another legitimate relationship still grants it. |
| S04 Attribute the source/referrer (L1-L2) | Accounts, contacts, account-contact links | Explicit source choice and constrained referral relationship, P2 | Record the referring person or company independently of the buyer's company; no duplicate free-text partner master or inferred commission. |
| S05 Select project sales context (B1-B2) | Module registry and tenant settings; no project master yet | Optional Real Estate, projects and one subproject level, P3; sales links, P4 | A salesperson selects an eligible project/subproject. An ordinary CRM business can complete the same sales flow without projects. |
| S06 Arrange calls and site visits (L3, B2) | Activities, CALL/MEETING, reminders, calendar, plans, reviewed rules | Carry project context through related enquiry/opportunity, P4 | Schedule a site visit using MEETING; record HELD/NO_SHOW and the next action with correct business-zone dates. No separate follow-up engine. |
| S07 Qualify and convert interest (L3-L4) | Enquiry status, configurable opportunity stages, atomic/idempotent conversion | Carry company/referral/target-close context, P2; project and property requirements, P4 | A retry creates one opportunity, preserving the contact, original enquiry and follow-ups. A failed write leaves no partial conversion. |
| S08 Record the sales result (L4) | Opportunity amount/currency, expected close, won/lost and required loss reason | Real-estate sample pipeline and sales requirements, P4 | A manager can configure stages; winning a deal records a sales outcome without creating a booking, receipt or reserved unit. |
| S09 Retain conversation continuity (L3, B2) | Customer interaction timeline, enquiry/deal notes, activity history, optimistic versions | Integrate new fields into audited changes, P2-P4 | Shared interaction summaries remain visible to authorized staff; private deal/internal details do not leak through a project or contact link. |
| S10 See sales progress and missed actions (L2, menus) | Personal/team work reports, overdue work, completion periods, deals without open activity | Project/source/owner pipeline and conversion reporting, P5 | Report denominators and date meanings are explicit; different currencies are not added together; project filters preserve access restrictions. |
| S11 Export and transition existing work (L2) | No CRM lead exporter or Ewissen importer | Permission-scoped export, P5; reviewed import/pilot, P6 | Export matches authorized filters; spreadsheet formula injection is prevented; import is repeatable using legacy IDs and reconciles accepted/rejected rows. |
| S12 Continue post-sale operations (B1-B2 and payment references) | Presales customer/deal/history only | Deferred release | Keep the existing system for CIF, booking, KYC/documents and collections until a separate rollout is defined. Do not claim full replacement. |

Pilot value checks: compare repeated contact entry, time to find an assigned lead,
handoff completeness, missing next actions and visibility of project sales progress.
No productivity improvement has been measured yet.

## Field ownership and requiredness

Extend ordinary typed records and existing controls. No universal custom-field
engine, business-specific copy of CRM or generic entity-ID relationship table.

| Information | Owner / delivery | Requiredness and behavior |
|---|---|---|
| Buyer name, primary email/mobile | CRM Contact / existing | Name required; email/phone optional. Preserve existing normalization and tenant-scoped uniqueness. A contact may have several independent enquiries and purchases. |
| Alternate phone and WhatsApp | CRM Contact / P2 | Optional, normalized international numbers. Same-as-mobile copies the current value; it is not a permanently synchronized relationship. These are communication details, not login IDs, identity keys or a messaging integration. |
| Buyer address | CRM Contact / P2 | Optional address lines, city, region, postal code and country code. No real-estate-only fields or mandatory address at lead intake. Use existing country controls; avoid introducing a new geographic service just for this form. |
| Enquiry title and requirements | CRM Enquiry / existing | Title/contact/active assignee required; requirements optional. Keep the salesperson's own description. |
| Lead source | CRM source choices + Enquiry / P2 | Optional tenant-managed choice; ADMIN/MANAGER manage, staff select. Default examples are configurable, not compulsory industry enums. |
| Buyer company | CRM Enquiry optional Account relation / P2 | Must be a same-tenant, accessible, active account linked to the buyer. Changing the buyer clears/revalidates company context. Link through the existing authorized relationship flow. |
| Referral / partner | CRM Enquiry / P2 | Optional referring contact OR account, mutually exclusive and independent of buyer company. Use explicit constrained relations; no commission amounts, partner portal or automatic access grant. Preserve on conversion in opportunity attribution. |
| Target close | CRM Enquiry / P2 | Optional business date, no time-of-day. Prefill the opportunity's existing required expected-close field at conversion; if absent, ask for the opportunity date rather than inventing one. |
| Created/updated/assigned metadata | CRM records and existing audit / P2 | Display persisted timestamps/actors. Show unknown for historical actors unavailable in data; do not attribute old records to the importer. New assignment changes record actor, old/new owner and time. |
| Project and subproject | Real Estate / P3-P4 | Optional primary project and optional child within that project; project required only when a subproject is selected. CRM without the extension remains usable. |
| Budget, preferred category, bedrooms, purchase timeframe | Real Estate sales context / P4 | Optional typed requirements, with currency for money and validated minimum/maximum. Keep property requirements separate from opportunity value and payment amounts. |
| Commercial value | CRM Opportunity / existing | Preserve decimal precision and currency. Do not reinterpret screenshot market value, sale consideration or brokerage as the same figure. Confirm those meanings before a later commercial module. |

Source migration in P2: create choices per tenant from existing nonblank source
values and populate links without erasing original text. Normalize whitespace/case
for matching; preserve the original label snapshot for history. Do not auto-combine
semantically different values. Retired choices remain readable on existing records
but cannot be newly selected; an unchanged retired value can survive another edit.
Any rollout backfill must be repeatable and checked before enforcing new references.

## Status and ownership mapping

- Enquiry NEW = captured interest; CONTACTED = contact attempted/established;
  QUALIFIED = credible sales interest; CLOSED = enquiry closed with an outcome.
  Keep the current four statuses initially. Legacy labels that do not map clearly
  are review items, not silently converted to CLOSED.
- A follow-up date is an activity. It must not replace the enquiry's status.
  Call NO_ANSWER is a call outcome, not a lost deal. A meeting is a site visit only
  when its title/context says so; do not relabel every existing meeting.
- Opportunity OPEN/WON/LOST stage kinds retain current meaning. Stage names are
  business configurable. A real-estate template may suggest Qualification,
  Site visit, Negotiation, Won and Lost without changing other businesses.
- Conversion remains one opportunity per enquiry and does not silently close the
  source enquiry. Separate purchases use separate enquiries/opportunities.
- Contact owner controls master-data editing; enquiry/opportunity assignee owns
  that sales record. Assignment-derived contact visibility does not confer contact
  editing rights. Explicitly assigned activities retain their own assignee.
- Shared company/project membership never implies access to every customer,
  enquiry, opportunity or internal note connected to it.

## Duplicate identity and import policy

The reference listing appears to reuse some contact details across people. It does
not prove whether these are households, companies, duplicate people or bad data.
There is no legacy data export available in this phase to resolve that question.

1. Keep current primary-email/phone uniqueness and generic conflict messages.
   Search authorized records first; a hidden collision requires manager review.
   Never expose a private contact's name/ID through validation or a suggestion.
2. Do not auto-merge people on name, email, phone or company. A manager must resolve
   shared details before import. Secondary/WhatsApp numbers are not identity keys.
   Do not fabricate unique addresses or silently drop conflicting details.
3. P6 import uses a tenant + source-system + legacy-record-ID map for repeatability.
   Preserve separate legacy leads even when an approved mapping reuses one contact.
   Preserve original source IDs, dates, status text and attribution in import records.
4. Unmapped owners/statuses, hidden/shared identities and invalid relationships go
   to a review report. Reconcile row counts and links on a pilot dataset before
   importing live sales records. No payment/document import in this release.

Before P6, obtain a representative export and the client's decision on legitimate
shared primary details. If shared primary identifiers are required, design and test
an explicit identity-policy change then; do not quietly remove unique constraints
as part of adding intake fields. This does not block the additive Phase 2 work.

## Module and project integration contracts (for P3-P4)

These are future implementation contracts, not a claim that the project module
exists. Current registry: `platform/modules.ts`; current module API accepts CRM only.

### Enablement and lifecycle

- Add one optional `realEstate` module dependent on `crm`, default disabled.
  Tenant ADMIN changes enablement; MANAGER/STAFF do not toggle modules.
- Reject enabling Real Estate while CRM is disabled and reject disabling CRM while
  Real Estate is enabled. Explain which module must be enabled/disabled first.
  Enforce both checks and the audited toggle atomically; concurrent toggles must
  not leave the dependency invalid. Do not rely on disabled UI controls.
- Disabling a module retains its records/links/history. Real Estate routes and new
  project mutations require the enabled module. Ordinary CRM remains operational.
- Omitted project context on a CRM edit preserves existing links; explicit clear is
  a separate authorized change. Turning Real Estate off must never unlink records.
- When Real Estate is disabled, ordinary enquiry conversion may carry an existing
  project link internally in the same transaction, without exposing project data
  or accepting new project selection. This is a narrow preservation operation,
  not general permission to call disabled-module services.

### Data relationships and access

- Real Estate owns project/subproject records, staff membership and explicit
  enquiry-project/opportunity-project links. Use tenant-scoped composite foreign
  keys and RLS for every new table, including joins. Enforce at most one primary
  project link per sales record and subproject membership in its selected project.
- One subproject level initially; no recursive hierarchy or unit inventory engine.
  Optional developer references an existing account; it does not grant unrestricted
  account/contact visibility. Archive projects/subprojects instead of deleting
  referenced history; archived choices cannot receive new links.
- ADMIN/MANAGER manage tenant projects/memberships. STAFF select active projects
  they are members of. Assigned enquiry/opportunity access grants read-only context
  for that record's existing project even after membership changes; it does not
  grant project management, unrelated deals, member lists or private developer data.
- Every linked sales record still uses CRM authorization. Project membership alone
  does not authorize viewing its leads, assigning another user or exporting records.
- Existing archived links remain readable. Conversion can preserve an existing
  archived source link; selecting a different archived project is rejected. Project
  changes use the parent sales record's optimistic version and required audit.

### Atomic conversion and updates

Extend the existing serializable CRM transaction in `modules/crm/sales-service.ts`.
Validate the actor, tenant, source enquiry, target stage, assignee and changed
relationships server-side. Read the source's current context within the transaction;
use the source version to reject a stale reviewed conversion when adding the new UI.

Create the opportunity, copied context, timeline and required audits together.
Pass the transaction client to a small integration helper; never call a service
that opens a separate transaction for the project write. Failure at any point
rolls back all of it. An existing converted opportunity returns the same record;
a retry never recopies newer enquiry fields over an already edited opportunity.
Subsequent enquiry and opportunity edits are independent and audited.

P3-P4 acceptance must cover tenant mismatches, nonmember choices, delegated read
context, inactive assignees, archived projects, disabled extension preservation,
stale versions, concurrent conversion/toggle requests, failed link/audit writes and
unchanged existing CRM-only flows. These tests cannot run until that code exists.

## Phase 1 verification

Baseline source: `c39cf99` before this phase's test/document additions.
Executed 2026-09-28:

| Check | Result / limits |
|---|---|
| `npm.cmd run test:crm` | 19 passed. Validation and history formatting. |
| Existing `npm.cmd run test:crm:integration` | 53 passed, 1 skipped before changes. Disposable local Postgres with tenant RLS and non-bypass application role. |
| Integration suite after four added cases | 57 passed, 1 skipped, 0 failures (58 total). |
| Hosted `crm-smoke.spec.ts` | 9 passed against `crm-test.salon.leigia.com`; read-only pages and unsaved forms. |
| Hosted staff checks | 4 passed, 1 skipped: no open assigned activity was available for the staff activity-detail check. This case was not verified live. |
| `contact-layout.spec.ts` + `crm-ui.spec.ts` | 11 passed using intercepted test data/writes; no hosted business mutations. Contact filters/pagination, archive/versioned saves, links, light/dark mobile, read-only access, keyboard dropdowns and separate save/complete controls. |
| `npx.cmd tsc --noEmit` | Passed. |
| `npx.cmd eslint tests/crm.integration.test.cjs` | Passed. |

The integration skip is the historical activity-upgrade fixture case requiring
`CRM_TEST_EXPECT_UPGRADE_FIXTURE=1`. A fresh schema was used, so this run is not
historical upgrade/migration certification. P2 migrations need their own upgrade
fixtures and backfill checks. New integration cases prove:

- Multiple independent enquiries/conversions retain one customer identity.
- CRM disable/re-enable blocks writes while preserving sales/work/history.
- Hidden duplicate conflicts disclose no private identity and failed edits roll back.
- A conversion-audit failure creates neither a deal nor partial conversion history;
  a subsequent retry remains idempotent.

Visually inspected the generated mobile overview, populated dark mobile contact and
light desktop contact captures. Sections, controls, timeline and pagination remain
usable. The overview's workload table uses horizontal scrolling at mobile widths;
this baseline does not claim every CRM screen has been visually inspected.
Mock contact screenshots intentionally use synthetic totals to exercise pagination.

Local evidence is ignored under `test-results/phase1-*.log` and
`test-results/performance/{crm-live-tests,phase1-ui-results}`. Sessions remain in
`.playwright-auth` and are not deliverables. No client records were seeded/reset.

## Next phase and later confirmation points

Phase 2 starts with additive contact fields and source choices, followed by
enquiry company/referral/target-close context, intake/search UI and regression
verification. Reuse standard CRM sections, fixed-choice dropdowns, searchable
record selectors, save/cancel placement, timeline and shared pagination.

No additional infrastructure or industry engine is necessary to start Phase 2.
Before pilot acceptance, confirm workflows not shown in the references, approved
source/status mappings, referral attribution needs, exact project/subproject
terminology and real-data identity policy. Unknown legacy commercial fields and
post-sale functions remain outside the current release. Do not present this
engineering baseline as client workflow sign-off or full application replacement.
