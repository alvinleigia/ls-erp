# Customer details and confirmation requirements - P3

Local implementation on the staging branch. No hosted migration, backfill,
module activation, push or deployment is included in this increment.

## Client usage

1. Tenant Admin opens Settings > Customer details, edits the form title/field
   labels and chooses required fields by participant role. Preview the effect on
   draft orders, then publish. The initial configuration makes no field mandatory.
2. Open an opportunity's Customer details tab. The name/identity stays linked to
   its main contact/business and additional participants. Edit the correspondence
   details for this transaction and save; incomplete drafts are allowed.
3. Save a quotation revision to capture those details and its form captions.
   The quotation and order views show that saved information.
4. Confirmation checks the selected saved revision using the current published
   requirements. Missing fields identify the participant and configured label.
   Correct the source, save a new revision, cancel the incomplete order draft and
   create its replacement. Existing frozen drafts are never silently rewritten.
5. Confirmed orders retain their selected facts and the exact rules accepted at
   confirmation. Later source edits, caption changes and stricter requirements
   do not change them.

Correspondence is separate from directory identity. Saving it does not edit a
contact/account, change its owner or merge people. Email/phone initially follow
accepted identity evidence unless transaction correspondence is explicitly saved.
Master addresses are not copied through an implicit directory access grant.
The transaction form supports email, international phone, address lines 1/2,
city, state/region, postal code and country. Directory entry and imports use the
same email/phone validation; master duplicate rules remain unchanged. Distinct
participants can share transaction correspondence without merging their identities.

Generic tenants use Customer details/Main customer/Additional customer labels.
Real Estate contributes only its CIF/applicant captions through the application
preset. Tenant captions can be changed without changing stable field/role codes.
Existing typed custom fields retain their existing save-time validation; P3 does
not create an expression-based workflow engine or automatically require them at
order confirmation. Names, IDs, amounts, statuses and access controls remain fixed.
No KYC uploads, signatures, government identity fields or ownership percentages
are collected by this form.

## Architecture and access

- `platform/participants` owns typed correspondence, bounded field definitions,
  role-specific required lists, pure validation and reusable UI/snapshot rendering.
  No shared code imports CRM or Real Estate implementations.
- CRM owns the native source relationships and `CrmOpportunity.participantInformation`.
  Information records reference only parties already present in its canonical
  contact/account relationships and participant children. The API rejects foreign
  or unrelated IDs and caller-supplied identity/security facts.
- Source Read/Edit, current profile action bounds, module activation, office and
  Restricted visibility apply. Saved correspondence remains readable with its
  source without borrowing directory or configuration administration permissions.
- Replacement uses the opportunity version, tenant security/mutation locks and
  source row lock. Stale source/configuration versions retain the UI draft until
  explicit discard/reload. Removing a party prunes only that party's information;
  changing role alone preserves the same identity's correspondence.
- `participantSettings` is an explicitly registered core permission resource and
  audit family. No saved profile is expanded. Read can be delegated; publication
  requires the actual active Tenant Admin as well as its action authorization.
- `ParticipantFormConfiguration` stores the current version. Preview and publish
  use the same definition and canonical readable draft-order population, paged
  in batches of 100. Their transaction stabilizes that population against the
  shared order writers and current security state. Publish recomputes its preview
  acknowledgement and rejects stale configuration or changed impact counts.
- Tenant Admin retains the existing cross-office oversight policy. Preview uses
  that same scope; it introduces no new office/sharing grant. It never reads
  another tenant's orders. A disabled/unavailable order module returns an
  unavailable impact, not invented zero counts.
- Every typed Sales Order source must supply the confirmation acceptance adapter.
  The application installs the shared validator against the selected immutable
  snapshot. No current contact lookup can repair or replace that saved revision.
  Order writers authorize after tenant/security locks using Read Committed;
  existing ordinary read transactions retain Serializable isolation.
- Quotations copy accepted correspondence plus their presentation version/captions
  in the same checked source transaction. Order confirmation records the current
  configuration version, preset and complete definition in `participantAcceptance`.
  These are separate acceptance points; neither is retroactively reconstructed.
- Strict source/configuration/order audits commit atomically. Correspondence
  updates audit references/versions rather than duplicating addresses in generic
  CRM root-edit audits. Mandatory audit failure rolls back the business change.

## Migration 134

`20261028000200_participant_information` adds the tenant-owned configuration table
and two nullable source/evidence columns. Existing values, references, snapshots,
assignments, profiles, team memberships and grants are not backfilled or altered.
The configuration table has forced tenant RLS and administrator-only native writes.
Versions advance by one and tenant identity is immutable.

Native acceptance evidence can be written only during draft-to-confirmed
transition and cannot be rewritten during cancellation or subsequent operations.
The original order guard excludes only that new column from its normal transition
comparison; the dedicated guard freezes it. The original record-sharing-only
exception remains intact. Old confirmed orders with no evidence keep that state;
no historical participant identities or policy certification are invented.

The UI now reuses a common discard/reload dialog instead of the earlier native
confirmation prompt for participant conflicts.

## Verification

- 54 focused participant, validation, architecture and calculation checks passed.
- 111 native and regression checks passed without skips. They cover authority
  loss, current policy after lock waits, preview acknowledgement conflicts,
  correspondence pruning, frozen selected revisions, immutable rule evidence,
  audit rollback, cross-tenant access and the 100-participant order/receipt/
  receivable path, plus the existing order, reservation and financial regressions.
  The focused checks overlap this suite; these are not additive test counts.
- The 134-migration rehearsal passed forced rollback and exact preservation of
  all 133 preceding tables, prior policies and functions. The old order guard's
  new-column exclusion is the only expected change to a prior function; its
  existing sharing-only exception is preserved. New columns remain null for old
  rows, and configuration starts empty.
- Four browser scenarios passed against the final built local app. They cover
  settings preview/publication, field validation, draft conflicts and reload,
  stale frozen order correction/replacement, generic and CIF labels, read-only
  access and delegated configuration reads, together with the P2 editor flows.
- Four P3 screenshots were inspected: desktop requirements, mobile editing,
  mobile confirmed order and the read-only CIF view. The 390px mobile view has
  no horizontal overflow; edit controls and validation feedback remain usable.
- Build including TypeScript, targeted ESLint and Git whitespace checks passed.

An earlier rehearsal caught a missing pre-existing sharing-only guard exception;
it was restored before acceptance. Intermediate tests also corrected fixtures
for existing Admin office oversight, composite order IDs, valid pipelines and
the existing order/quotation API methods/statuses. Those failed runs and an early
browser invocation made before the build completed are retained separately;
they are not presented as successful acceptance evidence. Final source changes
were followed by a new build and passing browser/native runs.

Private evidence: `tmp/participants/p3-evidence/receipt.json`; final native log
`tmp/industry-release/ls-erp-sales-orders-d5ebb8c4f2c5.log` (111/111); final browser
and migration log `tmp/industry-release/ls-erp-sales-orders-2923425e3819.log`
(4/4 browser scenarios).

Only disposable loopback PostgreSQL and synthetic browser accounts are used.
Uploaded pilot documents, hosted sessions, secrets and client records are not
used as test fixtures or committed.

## Next increment

P4 composes the booking flow and its necessary references/dates on top of this
accepted source contract. P5 adds shared document issuance and Real Estate letter
providers. Pilot-copy preservation and a separate hosted release remain P6.
