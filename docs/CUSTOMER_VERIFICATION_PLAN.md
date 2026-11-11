# Customer verification / KYC - proposed implementation

Planning date: 2026-11-10. Phase P13S. Updated 2026-11-11: the requirements/case
foundation is implemented and verified locally. See
[foundation evidence and remaining work](P13S_VERIFICATION_FOUNDATION.md).
Private evidence collection is implemented locally; see
[private evidence milestone](P13S_PRIVATE_EVIDENCE.md). Typed fact capture,
submissions/review and configurable checkpoints are implemented locally; see
[review milestone](P13S_VERIFICATION_REVIEW.md) and
[transaction checkpoint milestone](P13S_VERIFICATION_CHECKPOINTS.md).
Retention review and preservation holds are implemented locally; see
[P13S retention milestone](P13S_VERIFICATION_RETENTION.md). Controlled disposal
and automatic purge remain disabled. No hosted
database, tenant configuration or production changes have been made for KYC.

## Scope and decisions

Build a shared Customer Verification module. Tenants configure requirements for
people and businesses; industry modules consume its results through shared
services. Real Estate can apply the result to applicants and co-applicants without
owning the verification engine. The partner selection/correction work described
in PARTNER_RELATIONSHIPS_PLAN.md remains a separate workstream.

The first release provides internal evidence collection and human review.
Verified means an authorised tenant reviewer approved a particular submission;
it does not claim government or third-party identity verification. No specific
identity document is universally mandatory. This plan defines product controls,
not a determination of each tenant's statutory KYC obligations.

Keep three concepts distinct:

- Contact/account: canonical person or business within a tenant.
- Transaction correspondence: the address and contact details used for a booking.
- Verification: approved identity facts and supporting evidence, with a version
  and validity period. A completed CIF is not automatically verified KYC.

## 1. Shared foundation and requirements

- Register the module and resources in the existing activation and access
  catalogues. Default the module off for existing tenants.
- Define a verification subject using native tenant-scoped contact/account
  references. Each additional applicant has their own verification record;
  evidence is never shared across tenants.
- Model cases, versioned submissions, evidence metadata, review decisions and
  transaction acceptance proofs. Approved submissions cannot be overwritten.
- Publish versioned tenant policies covering required facts/document types,
  person versus business requirements, validity/expiry and applicable checkpoints.
  Reuse the participant configuration publishing pattern.
- Reference existing tax identities when appropriate; do not create another tax
  registration master or silently update GST data from uploaded evidence.

Completion: schema and migrations, tenant isolation, policy validation and
permission tests pass without changing existing record access.

## 2. Private uploads and collection UI

- Reuse platform/storage/client.ts, with a dedicated private evidence bucket and
  adapter. Do not use public branding storage or extend generated-PDF archive
  paths to accept arbitrary customer uploads.
- Start with PDF, JPEG and PNG, a proposed 5 MB per-file upper limit, bounded file
  counts and file-content/MIME checks. Preserve originals; logo optimisation does
  not apply. Do not render untrusted active content inline.
- Stage uploads, validate and finalise metadata, and clean up abandoned objects.
  Record byte size/checksum and immutable object keys. Handle storage/database
  failures without exposing incomplete uploads as accepted evidence.
- Serve evidence through an authorised download path. Recheck tenant, subject,
  record scope and evidence permission; keep bucket objects private. Any signed
  link used internally must be short-lived, with its bearer-link limitations
  accounted for.
- Add a Verification tab to customer/account details, with a compact status view
  for opportunity participants. Existing correspondence editing stays separate.
- Exclude raw identity numbers, file URLs and document content from general audit
  logs, ordinary CIF snapshots, analytics and PDF dynamic-field catalogues.

Completion: valid upload/download and failure cleanup work; spoofed files,
oversized uploads and unauthorised/cross-tenant downloads are rejected.

## 3. Review, status and expiry

Lifecycle: Not started -> In progress -> Under review -> Verified or Changes
required. Verified submissions become Expired when their validity ends.

- Collectors can enter details/upload/submit within their granted scope.
- Reviewers need explicit approval permission plus access to the subject/evidence;
  Manager role or ordinary customer access alone does not grant review/download.
- Require a reason for requested corrections, rejection/revocation and evidence
  replacement. Prevent self-approval by default.
- Review the exact submitted revision. Concurrent edits invalidate a stale review
  action; server-side validation checks all required evidence and dates.
- Replacement creates a new submission requiring review. Retain the prior
  approved revision and history, distinguishing it from the pending revision.
- Use server time for expiry, including eligibility checks; a delayed reminder
  job must not leave expired evidence eligible.
- Add a review queue and concise status/history views. Keep pages organised in
  tabs rather than adding long forms to opportunity details.

Completion: collector/reviewer boundaries, corrections, replacement, concurrent
review and expiry scenarios pass.

## 4. Reusable transaction checks

- Provide a shared verification eligibility service used by order confirmation,
  unit allocation and supported document issuance adapters. Requirements apply
  to all relevant selected applicants, not only the primary customer.
- Offer tenant-configured Off, Warn or Required behaviour at each supported
  checkpoint. Begin with Off; pilot with Warn before enabling Required.
- Check policy, approved revision, verified facts and expiry again on the server
  at the actual operation. UI badges alone cannot enforce eligibility.
- Freeze accepted policy/submission versions, decision actor/time and applicable
  validity outcome with the transaction checkpoint. Do not copy evidence files
  into each booking or generated PDF.
- Reuse valid verification for the same customer across transactions. A project
  correspondence address can differ; unrelated contact edits do not automatically
  invalidate identity approval. Changes to facts actually covered by approval
  require a new review under the policy.
- Historical accepted proofs stay historical. Policy changes do not rewrite old
  orders or claim that an expired verification was never valid.
- Do not automatically block recording payments already received, or modify
  existing issued PDFs. Additional checkpoints require explicit product scope.

Completion: warn/required modes, co-applicant checks, stale approval and policy
changes behave correctly across supported modules without altering sharing.

## 5. Retention, testing and rollout

- Configure retention and restricted deletion. Honour configured holds and
  transaction references before deletion; keep a minimal audit record without
  retaining erased identity content in ordinary logs.
- Replacing evidence is not deletion. Review access must remain available for
  retained historical evidence. Document deletion and backup expiry together;
  do not promise immediate removal from retained backups.
- Test retention decisions before enabling an automatic purge. No destructive
  cleanup of existing tenant data is part of initial activation.
- Verify database and private-object recovery together, including an evidence
  inventory. A database-only backup is insufficient for uploaded evidence.
- Use isolated local/staging fixtures for people, businesses, multiple applicants,
  multiple bookings, two tenants, collectors and reviewers. Cover private-file
  access, denied actions, replacements, expiry, review races, policy changes,
  transaction gates, upload failures and existing document/payment flows.
- Review staging results before a controlled production release. Take a verified
  backup, apply the reviewed migration once and confirm existing access survives.
- Enable the module for Ewissen only when requested, configure its policy and
  reviewer profile, and trial collection/review before mandatory booking gates.

Completion: meaningful automated tests and inspected browser results pass;
recovery and release checks are documented. Production customer data is not used
as disposable test data.

## Existing data and implementation boundary

Preserve all current customers, participants, assignments, bookings, documents
and payments. Do not duplicate customers, fabricate Verified statuses or require
historical customers to upload documents automatically. Use one canonical model
and shared access integration, without tenant-specific bypasses or dual-read
compatibility paths.

Implementation should start with step 1 and continue in reviewable increments on
local/staging. Production rollout is a separate release step. Automated identity
provider integrations, OCR and customer self-service collection are future work;
they are not prerequisites for the internal collection/review release.
