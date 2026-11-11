# Partner relationships and delegated selection — proposed

Research date: 2026-11-10. Implementation authorised subsequently by the user;
local implementation and verification are underway. No hosted database, profile
or tenant changes are authorised by this document itself.

## Confirmed scope

The user has not started entering CP attribution for this workflow. Implement
initial selection, addition after saving, replacement and removal together as
normal product operations. No temporary administrator impersonation, manual SQL
repair, tenant-specific exception, dual-read fallback or compatibility switch.
Existing customers, opportunities, users, assignments, documents and payments
remain in scope for preservation even though CP attribution has not been entered.

The target operator is Soniya, with Booking & Collections. Her account remains a
Manager, not a tenant administrator. Tenant configuration grants the relevant
actions; neither her name nor Ewissen's tenant ID appears in application rules.

## Decision

Use a shared partner-relationship service with delegated actions and existing
record scopes. Keep the internal salesperson, external partner attribution and
external login/sharing as separate concerns. Real Estate may label a partner
Channel Partner/CP; the platform concept remains industry-neutral.

Initially expose one primary introducing partner on an enquiry or opportunity.
Use an explicit relationship role and primary flag in the native model so adding
other relationship roles later does not require changing user ownership/access.
Do not introduce multi-partner allocation, commissions, tiers or routing now.

## Research and interpretation

- Odoo's Resellers feature supports manual/automatic forwarding and partner portal
  workflows. Its general security model separates granted actions from record
  rules. Partner forwarding is broader than identifying who introduced a sale;
  it should not be copied as automatic access for an introducing CP.
- Salesforce's Partners related list supports partner roles, multiple partners
  and a primary partner. Adding an opportunity partner requires Account Read and
  Opportunity Edit, rather than blanket administrator privileges.
- Dynamics 365 distinguishes stakeholder relationships from internal sales-team
  relationships; its sales access-team mechanism deliberately grants access.
  Our attribution action must not invoke such an access grant implicitly.

These findings support delegation and typed relationships. The precise permission
split, correction controls and one-primary initial UI below are our design
recommendations, not claims about identical controls in those products.

Sources:

- https://www.odoo.com/documentation/19.0/applications/sales/crm/track_leads/resellers.html
- https://www.odoo.com/documentation/19.0/developer/reference/backend/security.html
- https://help.salesforce.com/s/articleView?id=partners_edit.htm&language=en_US&type=5
- https://learn.microsoft.com/en-us/dynamics365/sales/stakeholders-sales-team-members

## Access contract

1. Partner choices: a bounded search returning only ID, name, code and type.
   Permission to select a partner does not expose the full administrative
   directory, private contact information, logins or supervisor accounts.
2. Link partner: permit initial selection or adding a missing relationship on an
   accessible record. Require the corresponding parent Create/Edit action too.
3. Correct partner: a separate, higher privilege for replacing/removing an existing
   relationship. Require a reason and the parent's Edit scope.
4. Manage directory: partner creation, archive, supervisor changes and logins
   remain administrator-only in this release.

Implement these through the existing resource/action catalog and source-derived
record scope, not account-role checks, tenant-specific branches or a parallel ACL.
Action names should use existing Read/Create/Edit vocabulary; UI may label them
View partner choices, Link partner and Correct partner.

The selectable population can be supervised partners or all active partners in
the tenant, explicitly granted through record limits. Reuse existing managed-people
resolution for team scope; a supervisor label alone never confers authority.
Parent company/office and Restricted-record rules remain mandatory. Selection
does not grant a new office membership or any access to the partner's login.

For Ewissen: explicitly grant Booking & Collections partner-choice Read,
relationship Read/Create and relationship Edit for corrections/removal, so Soniya
can perform the requested complete workflow. All-active-partner lookup is
reasonable for its central accounts function; operational record limits remain
unchanged. Preserve the profile's current permissions when adding these grants;
do not restore an older captured permission list or change other users' profiles.
This is profile configuration, not an Ewissen-specific code path. Future tenants
can omit Edit when corrections should be reserved for their supervisor.

External logins continue to identify their own introduction automatically. They
cannot impersonate another introducer or replace attribution using internal
delegation permissions.

## Data and history

- Retain the native tenant-bound introducer FK and evidence fields as the single
  primary relationship on each CRM source. Add CrmPartnerLinkEvent with native
  enquiry/opportunity FKs and an exactly-one-owner constraint. Shared code owns
  selection/correction validation and UI; CRM owns source persistence and scope.
  Future modules install typed adapters rather than adding unconstrained entity
  IDs or a second parallel current-link store. Parent versions provide optimistic
  concurrency. Additional relationship roles can be introduced explicitly when
  there is a concrete requirement, without changing staff assignment or sharing.
- Enforce one active primary introducer per owner in the database. Every change
  atomically records actor, timestamp, old/new evidence and reason. Initial
  creation evidence remains available; directory renames/supervisor transfers
  never rewrite that evidence.
- Conversion copies the enquiry's accepted attribution into the opportunity and
  records the lineage. Later correction is explicit on the relevant transaction;
  it does not silently rewrite the source enquiry, confirmed orders or PDFs.
- Reports use the canonical current primary attribution and saved supervisor
  evidence. Corrections may reclassify partner totals but must not duplicate a
  lead, opportunity, revenue figure or payment. Show a correction/history marker.
  Original introduction remains inspectable. Historical/as-of reporting is not
  promised in the first release.
- A read-only preflight verifies that the production CP selections are empty as
  stated. If nonempty selections are unexpectedly found, stop migration planning
  for review rather than discarding or silently reinterpreting them. No production
  backfill/repair utility is planned for an empty feature. Synthetic existing
  selections are still exercised in migration preservation tests.
- Use one canonical read/write path after cutover. Retain the existing valid
  native columns and report queries; replace the superseded immutable/admin-only
  guards through the new migration without fallback or per-tenant compatibility
  logic. Empty selection means No partner recorded, not
  Direct/Internal. Do not infer historical facts or alter the enquiry source ID.

The current admin restriction and immutable introduction guards exist in both
TypeScript and PostgreSQL. A new reviewed migration must replace the affected
guards and RLS deliberately; never edit the historical migration or just reveal
the existing dropdown.

## Implementation sequence

1. Foundation and permissions: define the shared partner relationship contract,
   CRM owner adapter, constraints, canonical lookup, source-derived scopes,
   append-only history and migration. Keep directory/login management separate.
   Deliverable: authorised API and direct-SQL tests pass, including rollback and
   conversion-source integrity, before enabling the form controls.
2. Complete operator workflow: use the same partner selector on enquiry and direct
   opportunity creation. Saved records show the selected partner and permit Add,
   Change and Remove according to grants. Require a reason for changes/removal
   and for adding attribution after the initial save; initial creation selection
   is already recorded by its creation event. Cancellation and changing the
   salesperson must not alter the partner. A Won stage does not permanently lock
   correction; the explicit Edit permission and normal record scope govern it.
   Deliverable: Soniya-equivalent non-admin tests cover the full workflow and
   denied controls; all actions use one service and record mandatory history.
3. Conversion, reports and document integrity: copy accepted enquiry attribution
   on conversion, read the canonical relationship in filters/tables/charts/export,
   and ensure one deal is counted once. Do not silently update source enquiry
   evidence or issued documents after an opportunity correction. Show old/new
   partner in History. Deliverable: before/after report totals, supervisor evidence,
   archived-partner display, financial balances and PDF archive checks pass.
4. Staging acceptance: apply the migration on a disposable rehearsal and staging,
   configure a synthetic Booking & Collections profile and run the end-to-end
   creation -> CP selection -> correction -> booking/documents/payment regression.
   Verify desktop/mobile and fresh permission revocation. Do not create pilot
   client sales or publish real templates as tests.
5. Production release: confirm empty CP selections and unchanged historical
   migrations, take the required verified recovery backup, perform the controlled
   schema/application cutover, then add only the new grants to the latest saved
   Booking & Collections profile. Verify effective permissions for Soniya and
   unchanged existing client data. Production release is a separate user action.

## Operator interaction

- New enquiry/opportunity: select an existing active CP in Partner details; the
  internal salesperson stays in its existing assignment field.
- Existing record without CP: Edit -> Partner details -> select CP -> enter reason
  -> Save. It is an ordinary supported workflow, not an administrative repair.
- Wrong CP: Edit -> Partner details -> choose replacement -> enter correction
  reason -> Save. Removing a CP uses the same authorised correction flow.
- History: show who made each addition/change/removal, when, the old/new partner
  and the reason. A failed or stale save commits neither the change nor a partial
  history event. Removing a CP does not delete the collaborator's directory entry.
- Referencing a CP does not create a login, share customer data, reassign the sale,
  change office access or calculate a commission.

Required acceptance cases: authorised staff selection; denial without parent or
partner-link permissions; supervised/all choices; inactive/cross-tenant partners;
hidden/private records; revoked permissions; external self-attribution; conversion
lineage; additions/corrections after saving; duplicate/concurrent requests; stale
versions; mandatory audit/rollback; archived directory entries; restricted company
and office access; unchanged grants, confirmed documents, payment amounts and
existing report totals after migration. Do not test by creating pilot-client sales.

Success for Soniya: she can choose an eligible active CP on a new opportunity,
add a missing CP later, and correct/remove a mistaken selection with a reason on
cases she may edit, using explicitly granted actions without becoming an
administrator. Directory administration and external login access remain separate.
