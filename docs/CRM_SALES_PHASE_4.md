# Phase 4 — Project-linked sales workflow

Implemented and verified locally on 2026-09-28. Not deployed; no hosted schema
or business records were changed. Phase 5 reports and export remain next.

## Delivered

- Optional project and subproject selection on enquiries and opportunities,
  with a separate Property interest section for budget range/currency, property
  category, bedrooms and buying timeframe. Requirements can be recorded without
  choosing a project. Deal value/currency remain separate from the buyer budget.
- New lead and New opportunity actions on active project/subproject pages,
  preselecting their context. Related enquiries, opportunities across pipelines,
  and activities use access-scoped server pagination and shared CRM sections.
- Project/subproject filters on enquiry lists and opportunity list/board views.
  Sales rows/cards show the linked project names. Root project views include
  their subprojects; a subproject filter narrows the selection.
- Conversion copies the enquiry's current property context in the existing CRM
  transaction. Its target close date prefills the form and is the API fallback
  when no explicit expected date is provided. Repeat/concurrent conversions
  return one authorized opportunity and produce one conversion history entry.
  Later opportunity edits do not change the enquiry's captured requirements.
- An explicitly applied, editable **Property sales** pipeline draft: Qualified
  interest, Site visit planned, Site visit completed, Proposal, Negotiation,
  Won and Lost. Creating the draft does not write anything; saving creates a
  new pipeline. Existing stages and business pipelines are never overwritten.
- Site visits reuse MEETING, follow-ups reuse CALL, with the existing schedule,
  reminder, assignee, outcome and history controls. Completing an activity does
  not automatically move a deal to another stage.
- Common Save/Cancel actions, searchable selectors, shadcn dropdowns, section
  cards and pagination. Desktop/mobile light/dark screenshots were inspected;
  the tested forms and project page have no document overflow.

## Access, preservation and transactions

Project membership and CRM record ownership remain separate. Managers can select
active projects in their business; staff can select their assigned active projects
and inherited subprojects. A salesperson receiving an existing enquiry/deal may
read its linked project name/code/archive state and requirements, even without
project membership. This does not grant access to the full project, developer
account, membership list or other salespeople's records.

Archived links remain readable on accessible sales records. Existing links can
be retained while changing requirements or cleared, but new links must target an
active, accessible root project and a matching active subproject. Conversion
preserves existing archived links. Project-filter choices include brief retained
references so authorized staff can still find their records after reassignment.

Project-related activities additionally require access to the containing enquiry
or opportunity. A delegated activity on a private parent remains available in My
Work, but cannot reveal that parent's project through filtering.

Disabling Real Estate hides property context and rejects project-filter/context
changes. Ordinary CRM edits preserve the stored extension data. Conversion still
copies existing context while the module is off; re-enabling restores visibility.
No project, customer, sales record or history is deleted by a module switch.

Both enquiry and opportunity APIs accept optional `propertyContext`:

- Omitted: preserve existing context (including older clients/module-off edits).
- Object: replace the optional context fields; omitted object fields are empty.
- Explicit `null`: clear context, requiring the module and normal edit permission.

Edits use the containing CRM record's optimistic version. Context writes and
conversion copies write required audit records in the same serializable
transaction. Failure rolls back the parent change, inline contact, context and
history together. A conversion cannot submit replacement property context;
edit the saved opportunity instead. An optional enquiry version detects stale
conversion forms, while retries can return the already-created accessible deal.

## Architecture and migration

`modules/real-estate/sales-context.ts` owns narrow extension operations invoked
inside existing CRM transactions; it does not start nested service transactions.
Validation, form sections, captions, filters and pipeline draft data belong to
`modules/real-estate/`. There is no second contact, opportunity or activity engine.

Migration `20260928190000_real_estate_sales` adds one optional extension row per
sales record: `RealEstateEnquiryContext` and `RealEstateOpportunityContext`.
Tenant RLS is forced on both tables. Composite foreign keys constrain the sales
record, project, and project/subproject pairing to the same business. Database
checks cover budgets, currency shape, bedrooms, category and buying timeframe.
No existing CRM identifiers, versions, timestamps or relationships are rewritten.

Apply the Phase 2, 3 and 4 migrations in order before releasing the application.
Real Estate remains opt-in per business and depends on CRM. No hosted seed/import
or automatic pipeline creation is part of this delivery.

## Verification

- Applied the actual additive Phase 4 migration to a disposable PostgreSQL
  database starting from the Phase 3 schema, with existing synthetic CRM data.
  The upgrade assertion confirms legacy identifiers, versions, dates, attribution,
  amounts and conversion relationships remain unchanged.
- Real Estate suite: 16 tests pass, including the separately opted-in upgrade
  assertion. Coverage includes project hierarchy/membership, tenant RLS/FKs,
  context validation, atomic rollback, preserved/cleared/stale edits, reassignment,
  conversion concurrency, module-off/archived context, scoped pagination and
  project-linked visit/follow-up/won/lost behavior.
- Existing CRM integration suite: 62 pass; two earlier migration fixture checks
  remain skipped for this Phase 3 baseline. Nineteen existing unit tests pass.
- Final sequential integration run: 77 pass, three fixture-gated checks skipped
  (including the separately verified project upgrade assertion). Run these suites
  sequentially: existing tests temporarily add database-wide audit constraints.
  A simultaneous invocation was stopped after an existing plan race check failed;
  that check passed in isolation and in the complete sequential rerun.
- Browser: 20 existing CRM/project regressions plus two new opt-in local sales
  scenarios pass. New scenarios cover project/subproject actions, explicit pipeline
  creation, inline lead/qualification/conversion, MEETING completion and Won,
  related records, matching board/list project filters, budget rollback, standalone
  opportunity creation, module-off editing and archived context retention.
- TypeScript, targeted ESLint, Git whitespace checks and production build pass.

Integration command (disposable local database only):

```powershell
node --require ./tests/register.cjs --test --test-concurrency=1 tests/crm.integration.test.cjs tests/real-estate.integration.test.cjs
```

Set `CRM_TEST_DATABASE_URL` to a local database named `ls_salon_crm_test`. The
upgrade fixture check additionally uses `CRM_TEST_EXPECT_PROJECT_UPGRADE=1`.
Prepare from the Phase 3 schema using `scripts/prepare-crm-test-db.cjs` and
`CRM_TEST_FROM_MIGRATION=20260928190000_real_estate_sales`.

Browser writes are skipped unless `CRM_BROWSER_LOCAL_WRITES=1` and the base URL
is exactly the isolated fixture `http://intake-upgrade-a.localhost:3001`.
Authentication files and screenshots remain ignored. The production build was also served locally and its populated project page
was checked in desktop dark mode. Hosted verification is pending.

## Next phase

Phase 5 adds sales visibility and filtered exports: source/project/salesperson
breakdowns, conversion and pipeline/won/lost reporting, defined date/currency
semantics, and reconciliation with accessible lists. Payments, documents,
reservations and unit inventory remain outside this CRM/sales increment.
