# P13S - Partner attribution and customer verification

Status: implementation started, 2026-11-10. The CP workstream is implemented
and verified locally. The KYC requirements/case foundation is also locally
verified. Private evidence collection, typed submissions and independent review
are implemented locally. Participant summaries and configurable transaction
checkpoints, retention review and reasoned preservation holds are implemented locally.
Controlled disposal is implemented locally; combined hosted staging acceptance remains pending. This document coordinates
the two workstreams; it does not authorise production changes.

Detailed specifications:

- [Partner relationships and delegated selection](PARTNER_RELATIONSHIPS_PLAN.md)
- [Customer verification / KYC](CUSTOMER_VERIFICATION_PLAN.md)

## Outcomes

1. An authorised non-admin operator such as Soniya can select an existing CP
   when creating an opportunity, add one later, and correct/remove a mistaken
   selection with a recorded reason.
2. Customers and each co-applicant can supply evidence for tenant-configured
   verification, reviewed by a separately authorised reviewer.
3. Modules use shared access, history and verification contracts. Real Estate
   contributes its terminology and allocation checkpoint, rather than owning
   another permission or KYC implementation.

## Delivery order

### A. Confirm the baseline and access contract

Read the current schemas, database guards, effective grants, scope rules and
saved policies before implementation. Verify actual CP usage read-only; the
user reports that this workflow has no CP selections yet. Unexpected existing
attribution must be reviewed and preserved, not discarded to simplify migration.

Keep internal salesperson assignment, CP attribution, external login/sharing,
customer correspondence, identity verification and payment recording separate.
Use existing resource/action permissions and record/company/office scopes.

Success: reviewed migrations and acceptance cases cover both permitted and denied
actions, with no change to existing user access.

### B. Complete the CP workflow first

Implementation decision: the existing tenant-bound introducer foreign keys
already enforce one primary introducing partner per CRM record. Retain these as
the canonical link and add typed immutable change history, rather than creating
a duplicate relationship table and rewriting otherwise-correct report queries.
Shared orchestration and native CRM source adapters provide the reusable boundary.

- Build the shared relationship service with a typed CRM owner adapter, native
  tenant-bound references, one active primary introducer and immutable history.
- Replace the existing admin-only/immutable guards deliberately through a new
  migration, including affected PostgreSQL guards/RLS and application checks.
- Add a bounded partner-choice lookup. Selection exposes only the fields needed
  to identify eligible active partners, not their private directory/login data.
- Use the same selector on new enquiries and direct opportunities, subject to
  their own parent Create permissions. Support Add on saved records and Change
  or Remove under a distinct correction permission plus parent Edit scope.
- Require a reason for additions after saving, replacement and removal. Show
  actor, time, previous/new partner and reason in History; reject stale saves.
- Preserve attribution lineage when converting an enquiry. Later corrections
  affect the selected record explicitly, not every related record automatically.
- Update filters, reports and exports to use the canonical relationship without
  counting a deal more than once. Saved supervisor evidence remains historical.
- Do not rewrite confirmed order snapshots or issued PDFs after a CRM correction.
  Historical documents retain their facts; a separate authorised document
  replacement remains necessary when its content needs correction.

For Ewissen, extend the latest Booking & Collections profile with partner-choice
Read, relationship Read/Create and correction Edit. All active tenant partners
are appropriate choices for its central accounts role; the opportunity's normal
access limits still apply. Preserve every existing grant and other profiles.
Soniya remains a Manager, not a tenant administrator. Directory creation/archive,
supervisor changes and login administration remain separate admin operations.

Selecting a CP does not reassign the salesperson, share a record, grant a login,
change office access, or calculate a commission. External self-attribution cannot
be used to impersonate another partner. Won opportunities can still be corrected
when the operator has the explicit correction grant and parent Edit scope.

Success: a Soniya-equivalent non-admin test account completes creation, later
addition, replacement and removal; negative access/concurrency tests pass.

### C. Build customer verification and secure collection

Foundation complete locally: default-off module, policy/case permissions,
versioned requirements settings, immutable native policy/case identity and
canonical subject scope. Evidence: `P13S_VERIFICATION_FOUNDATION.md`.
Private uploads and the customer/account collection tabs are implemented locally;
see `P13S_PRIVATE_EVIDENCE.md`. Typed fact capture and submission/review are now
implemented locally; see `P13S_VERIFICATION_REVIEW.md`. Compact transaction
participant statuses and configurable checkpoints are implemented locally; see
`P13S_VERIFICATION_CHECKPOINTS.md`.

Create a shared module, disabled for existing tenants initially. Link each case
to the canonical person or business; each co-applicant has their own case.
Publish versioned requirements for required facts, evidence types and validity.
Reuse valid verification across transactions within a tenant, rather than storing
the same evidence per project. Project correspondence can remain different.

Add a Verification tab to customer/account details and compact participant
statuses. Store evidence in a dedicated private Supabase bucket using the shared
storage client, validated types/content, bounded sizes/counts, immutable versions,
checksums, authorised downloads and abandoned-upload cleanup. Never use the public
logo bucket. Proposed initial types are PDF/JPEG/PNG with a 5 MB per-file limit.

Success: collection and private retrieval work, including failure recovery,
cross-tenant denial and denial for ordinary customer readers without KYC access.

### D. Review, expiry and transaction integration

Independent review, correction/revocation history, database-clock validity and
latest-revision/policy-change statuses are implemented locally. Transaction
participant checks and immutable acceptance proofs are implemented locally;
retention review, preservation holds and controlled disposal are implemented locally.
See `P13S_VERIFICATION_RETENTION.md` and `P13S_VERIFICATION_DISPOSAL.md`.

Implement Not started, In progress, Under review, Verified, Changes required and
Expired states, backed by versioned submissions and recorded review decisions.
Prevent self-approval by default. Replaced evidence requires fresh review; retain
prior approved evidence according to retention rules. Use server time for expiry.
Verified initially means internal reviewer approval, not government verification.

Create separate collector and reviewer permissions. Booking & Collections may
collect/submit within its record scope if granted; it does not automatically
receive approval authority. Tenant configuration chooses the reviewer profile.

Provide shared server-side eligibility checks at order confirmation, allocation
and supported document issuance. Each checkpoint supports Off, Warn or Required,
initially Off. Freeze the accepted verification/policy revision with the action.
Do not block recording money already received or modify historical documents.

KYC approval does not grant opportunity sharing; CP attribution does not grant
access to customer identity files. Restrict sensitive evidence independently.
Add retention/hold/deletion decisions and test them before automatic purge.

Success: review, expiry, policy changes and all applicable participant checks
work, including stale requests and permission revocation.

### E. Combined staging acceptance and controlled release

Use isolated local/staging data to test:

- Enquiry -> opportunity conversion and direct opportunity creation.
- Initial CP selection, later addition, correction/removal and audit history.
- Inactive/cross-tenant partners, Restricted records, office scope, external
  users, revoked grants and concurrent edits.
- Multiple applicants, evidence replacement, expiry, review and policy changes.
- CP corrections before/after Won, with stable financial/report totals.
- Quotation -> sales order -> reservation/allocation -> document issue/download
  -> payment/receipt, including existing templates and archived PDFs.
- KYC gates with Off/Warn/Required, including a missing/expired co-applicant.
- Database and private-file recovery together; failed upload/issuance cleanup.
- Desktop/mobile presentation, preserving existing tabs and navigation state.

Review the evidence before production rollout. Take a verified database and
storage recovery backup, rehearse the canonical migration/cutover and deploy the
matching application. Remove superseded CP paths without tenant-specific
fallbacks. Add only the new profile grants, then verify effective Soniya access
without creating disposable sales records in the pilot tenant.

Enable KYC for Ewissen only when requested, configure requirements/reviewers, and
trial collection/review before mandatory transaction gates. Existing customers,
assignments, booking/payment data and issued PDFs stay intact. No automatic
Verified statuses, customer duplication or retroactive booking blocks.

## First-release boundary

Include the complete CP add/change/remove workflow and internal KYC collection,
review, evidence access, validity, history and configurable checkpoints.
Do not add commissions, multi-partner financial allocation, automatic partner
sharing, OCR, identity-provider integrations or customer self-service collection
as hidden dependencies. The model supports extension through shared contracts;
future business requirements will still need normal implementation and testing.
