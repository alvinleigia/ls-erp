> **2026-09-29: superseded forward plan.** Use [CRM Odoo alignment](CRM_ODOO_ALIGNMENT_PLAN.md) for the next refactor phases. The user has brought configuration and reusable custom-field foundations forward. The phase and deployment statuses below are historical, not current release status.

# CRM and sales delivery plan

Updated: 2026-09-28. Status: Phase 1 engineering baseline and mapping complete;
Phases 2-5 implemented and verified locally, pending deployment. Phase 6 internal
regression is underway using the existing CRM Test leads; no client pilot or
legacy import is requested. See [Phase 6 readiness](CRM_SALES_PHASE_6.md),
[Phase 5 delivery and verification](CRM_SALES_PHASE_5.md),
[Phase 4 delivery and verification](CRM_SALES_PHASE_4.md),
[Phase 3 delivery and verification](CRM_SALES_PHASE_3.md),
[Phase 2 delivery and verification](CRM_SALES_PHASE_2.md) and
[Phase 1 results and contracts](CRM_SALES_PHASE_1.md) for tested behavior,
implementation defaults and future business confirmations.

This active plan follows the user's decision to focus on CRM and sales. It
supersedes the earlier six-phase sequence. EWISSEN_CRM_GAP_REVIEW.md remains a
reference; its phase references describe the earlier plan.

## Release outcome

Identify/create a contact, capture a lead, assign a salesperson, qualify interest,
link a project, arrange calls/site visits, progress an opportunity and record
won/lost with a complete interaction history.

## Product objective: current workflow coverage plus added value

The client's screenshots are reference evidence of current work, not a prescribed
UI, field layout, data model or exhaustive requirements list. The product should
eventually support all agreed current business workflows and improve how they are
performed. The current release covers CRM and sales; deferred post-sale workflows
remain on the product roadmap rather than being discarded.

- Map business outcomes and roles, not screens one for one. A legacy screen may
  map to several connected records in the new system; existing shared CRM
  functionality may already satisfy a requirement without new development.
- Confirm workflows beyond the supplied screenshots before declaring complete
  coverage. Menu labels alone do not establish detailed requirements.
- Keep reusable requirements in shared CRM and small business settings; place
  genuinely industry-specific data and rules in optional extensions.
- For each agreed CRM/sales workflow, record the current task, the new flow,
  existing functionality to reuse, remaining gaps, intended improvement and an
  acceptance scenario. Distinguish release requirements from later enhancements.
- Compare whether users can achieve the business result, with correct visibility,
  data continuity and history. Visual similarity to the old application is not
  an acceptance criterion.

Value to demonstrate in the sales pilot:

| Outcome | Foundation to reuse | Improvement to deliver or verify |
|---|---|---|
| Fewer missed follow-ups | Activities, reminders, plans and reviewed follow-up rules | Visible overdue work and deals with no next action, including project context |
| Better staff handoffs | Shared interaction timelines and assignment controls | New assignees can continue a lead without losing history or project requirements |
| Clearer sales progress | Configurable pipelines and opportunity board | Project/source/owner reporting and explicit conversion/won/lost measures |
| Less repeated data entry | Contacts, account relationships and lead conversion | Efficient intake and project/requirements context carried through conversion |
| Reliable customer records | Existing normalization and duplicate checks | A reviewed identity policy that also handles the client's legitimate shared details |
| Easier daily operation | Standard forms, dropdowns, sections and pagination | Find leads by useful business attributes and complete key flows on desktop/mobile |

These are acceptance goals, not measured improvements or newly implemented
capabilities. Establish the client's baseline during phase 1 and validate the
new workflows during the pilot; do not claim productivity gains without evidence.

In scope: contacts/accounts, lead intake, assignment, basic referral attribution,
projects/subprojects for sales, opportunities, pipelines, activities/site-visit
meetings, sales reporting, export and a controlled pilot.

Deferred: CIF/customer applications, co-applicants, identity/KYC details, uploads,
unit stock/availability, holds, reservations, bookings, instalments, collections,
receipts, interest, commission calculations and accounting. External messaging,
telephony and lead-source integrations are separate future work.

## Boundaries to preserve

- Keep the tested CRM services and workflows; extend incrementally following
  MODULAR_PLATFORM.md, CONVENTIONS.md and BROWSER_TESTING.md.
- Preserve tenant isolation, assignment-based visibility, history/audit,
  optimistic edit checks and one-conversion-per-enquiry behavior.
- CRM owns contacts, accounts, enquiries, opportunities and sales activities.
  Optional Real Estate owns projects and project links and depends on CRM.
- Ordinary CRM remains usable without Real Estate or project selection.
- Reuse shared forms, controls, timelines, search and pagination. Extract shared
  code only when another consumer needs it; do not duplicate industry CRM pages.
- Use explicit tenant-scoped relationships and server validation.
- Start with one optional primary project/subproject per enquiry/opportunity.
  Independent purchases use separate opportunities; shortlists are later scope.
- Project visibility does not grant access to all customers or deals within it.
- Module disablement preserves data. Specify dependencies and disabled-link
  behavior in phase 1; prevent disabling CRM under an enabled dependent module.
- A Won opportunity records a sales outcome. It does not reserve inventory,
  create a booking or record money received.

## Phase 1 — Baseline and client sales mapping

Deliver:
- Build the workflow coverage and added-value matrix described above. Confirm
  must-have sales outcomes, including those not visible in the screenshots.
- Map screenshot fields, statuses and ownership to Contacts, Enquiries,
  Opportunities and Activities. Define required vs optional information.
- Specify company/referral relationships, project hierarchy and an optional
  enquiry target-close date carried forward during conversion.
- Investigate shared emails and repeated-looking legacy records. Define duplicate
  review and import identity rules; do not silently relax uniqueness or merge
  people because they share contact details.
- Record fresh relevant regression results and fill critical gaps in conversion,
  assignment/reassignment, visibility, follow-ups and reporting.
- Define small module dependency, access and atomic project-link contracts.

Exit: field/status/access mappings and baseline results recorded. No broad
refactor or hosted data import/reset.

## Phase 2 — Practical lead intake

Status: implemented and verified locally; see [delivery notes](CRM_SALES_PHASE_2.md).

Deliver:
- Optional contact address, alternate telephone and separate WhatsApp number,
  with a same-as-mobile convenience control. This captures details, not messaging.
- Efficient existing/new-contact intake preserving duplicate checks and one
  customer identity across multiple enquiries.
- Managed per-business source choices, with migration of existing free-text
  values and preservation of historical selections when choices are retired.
- Company context and basic referral attribution through constrained account/
  contact relationships; no commission or partner portal.
- Optional enquiry target-close date and useful creation/update/assignment metadata.
- Lead search by customer name, phone and company; required source/salesperson
  filters with server pagination and permission-scoped results.

Exit: staff can capture, find, assign and follow up realistic client leads.
Existing contact/enquiry behavior and permissions still pass.

## Phase 3 — Optional Projects for sales

Deliver:
- Real Estate enablement, CRM dependency and Projects navigation.
- Project name/code, optional developer account, location, description, property
  categories, indicative price range/currency, sales lifecycle, responsible staff
  and archive state. These describe marketing context, not unit availability.
- A simple project/subproject hierarchy matching the client's sales context,
  with business-scoped unique codes and valid parent/child selection.
- Manager administration, staff read scopes, RLS, audit and version checks.
- List/detail/forms using shared components and additive migrations.

Exit: projects/subprojects can be created, searched and archived; role,
tenant-isolation and module-off checks pass. Generic CRM stays usable.

## Phase 4 — Project-linked sales workflow

Deliver:
- Optional project/subproject selectors and constrained links to leads and
  opportunities. Preserve links on edit and copy context/target-close dates in
  the existing conversion transaction, including repeat/concurrent requests.
- Project-specific New lead/New opportunity actions; paginated related leads,
  opportunities and activities; matching list/board project filters.
- Optional Real Estate requirements: budget range/currency, property category,
  bedrooms and buying timeframe. Keep shared customer details in one place.
- An editable property-sales pipeline using existing pipeline functionality,
  applied explicitly without overwriting existing business stages.
- Existing MEETING activities for site visits and CALL activities for follow-ups:
  assignee, schedule, reminder, outcome and notes. No transport/resource booking
  or automatic pipeline transitions are implied.
- Audit project/owner changes and retain readable archived links where authorized,
  while preventing archived projects from being selected for new business.

Exit: lead -> qualification -> project-linked opportunity -> visit/follow-up ->
won/lost works end to end. Generic CRM and module-off flows continue passing.

Phases 1–4 deliver the first end-to-end sales pilot.

## Phase 5 — Sales visibility and export

Deliver:
- Leads by source/project/salesperson, conversion, pipeline by stage, won/lost
  deal value, overdue follow-ups and opportunities without scheduled work.
- Explicit date semantics, conversion denominators and role visibility. Count
  each deal once, keep currencies separate and distinguish deal value from receipts.
- Reconciliation with filtered lists while retaining current activity/workload reports.
- Access-scoped lead/opportunity export respecting filters, with defined columns,
  appropriate handling of large exports and spreadsheet formula escaping.

Exit: reports and exports reconcile with accessible records for each role.

## Phase 6 — Internal regression and sales rollout readiness

User clarification, 2026-09-28: this is our own validation using the leads already
created while testing CRM, not a client-requested pilot. No import is needed now.

Deliver:
- Read-only admin/staff regression on the existing CRM Test records, preserving
  identity, conversion, history, permissions and activity-report reconciliation.
- A before/after deployment baseline and explicit checks for the new features;
  missing hosted routes are deployment blockers, not successful verification.
- After deployment, exercise the new source/project context, handoff, site visit,
  reminders and sales reports using the existing Alex Taylor/Taylor deal records.
  Reuse the contact if a new labelled test enquiry is needed for conversion.
- Record local and deployed results separately and inspect desktop/mobile,
  light/dark screenshots. Do not rerun hosted seeds or reset the test business.
- Keep post-sale ownership explicit: the existing application continues to own
  bookings, documents, inventory commitments and payments. No synchronization or
  import is part of this validation step.

Exit: existing test data survives the upgrade and the new CRM/sales workflows
pass on the upgraded test business. Wider rollout and any future client review
remain separate decisions. See CRM_SALES_PHASE_6.md for the current evidence and
remaining sequence.

## Configuration and future extensibility

Use existing configurable pipelines/plans/rules and small managed settings such
as source choices now. A general custom-field/layout/template editor, additional
industry modules and property operations remain future increments. Use stable
identifiers, explicit relationships, versioning and shared UI boundaries so those
additions do not require duplicate CRM implementations. A universal object engine
is not a prerequisite for this release.

## Verification and rollout

- Use additive migrations tested with existing CRM records in a disposable database.
- Run focused checks plus critical CRM regressions when shared services change.
  Cover roles, tenant isolation, module-on/off and edit/conversion conflicts.
- Hosted smoke tests remain read-only. Mutations use fixtures or authorized
  isolated records. No hosted seeding/reset or unreviewed bulk imports.
- Preserve data when modules are disabled. Record deployed results separately
  from local checks and inspect screenshots before claiming visual verification.

Next step: deploy Phases 2-5 through the normal release process, compare the
existing-record baseline, and finish Phase 6 using those same test leads.
Hosted migration/deployment and new sales workflow verification remain pending.
