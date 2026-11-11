# P13S production readiness and Ewissen access proposal

Read-only preflight completed on 2026-11-11. This is a release preparation
checkpoint, not a production deployment or permission-change receipt.

## Verified baseline

- Production `ls-erp` remains READY at `b28223f`, with 150 applied migrations,
  one retained historical rollback attempt and seven P13S migrations pending.
  The history is a contiguous, checksum-verified prefix; no earlier SQL changed.
- Staging `ls-erp-staging` is READY at `ccb486a`. Its application code matches the
  local candidate. The subsequent local changes concern tests, evidence and
  release preparation. See `P13S_ACCEPTANCE.md` for hosted acceptance results.
- The manifest `release-source-p13s.json` pins all 157 migrations, the production
  baseline inventory and the candidate schema. `scripts/p13s-release-readiness.cjs`
  checks these without loading environment files or connecting to any service.
- Production runtime role `prisma_app` remains non-superuser and NOBYPASSRLS.
- Ewissen has 3,047 enquiries, no recorded CP introductions on those enquiries,
  and no opportunities, quotations, orders, receipts or issued order documents.
  No historical attribution rewrite is required by this proposal.

Deployment and migration state must be rechecked immediately before cutover;
this snapshot is not a substitute for fresh release checks.

## Soniya: central Booking & Collections

The user selected **all Ewissen sales — central accounts role**. Soniya is an
active internal Manager. Booking & Collections is assigned only to her; its
current version is 3 and it has 37 permissions.

The prepared proposal preserves every existing permission and adds exactly:

- `partnerChoices.read`: bounded CP choices, without private directory access.
- `partnerLinks.read`, `partnerLinks.create`, `partnerLinks.edit`: view, select
  and correct the introducing CP through the dedicated, audited workflow.

The resulting profile contains 41 permissions. Her record policy broadens the
following existing actions to All accessible records, plus the four CP actions:

| Area | Existing actions receiving central scope |
| --- | --- |
| Contacts and accounts | Read contacts/accounts; edit contacts |
| Projects and assignment choices | Read projects, teams and assignment targets |
| Opportunities | Read, edit, assign and export |
| Quotations | Read, edit and export |
| Sales orders | Read and confirm |
| Receivables and payments | Read and create |
| Order/payment documents | Read, create and export |
| Unit reservations | Read, create and confirm |

These are capability-specific scopes, not an administrator role. All accessible
records still intersects office access and Restricted sharing. Her existing
office grants cover the one current active office. New offices require their
own access configuration; this proposal does not grant future offices implicitly.

Keep her Manager role, all profile assignments, office memberships, creation
context, other record rules and other users unchanged. The other shared profile
is untouched. No enquiry action, project edit, user administration, CP-directory
administration, refund/cancellation or KYC authority is added. Existing unrelated
capabilities remain as they are. Direct opportunity creation remains her supported
entry point; this proposal does not enable enquiry creation.

The actual payload is private under ignored `tmp/p13s-production`; it includes
expected role/policy versions, the before/after scope delta and office snapshot.
It passed the normal profile/assignment schemas and effective scope evaluation.
Pure proposal/history/source tests also cover repeatability and invalid inputs.

After deploying the matching application, re-read the user, role, assignments and
office policy. Stop and regenerate the proposal if they differ. Apply through
the normal versioned access service as an active tenant administrator, preserving
its audit trail. Do not use a direct SQL permission patch or silently overwrite a
concurrent administrator edit. Verify with a fresh Soniya session afterwards.

## Remaining release and activation work

1. Take an encrypted production application/storage backup and verify an isolated
   restore and seven-migration upgrade against the current pilot data. The staging
   backup and synthetic acceptance do not establish pilot recovery.
2. Agree the production maintenance window, recheck source/history/deployments,
   preserve fresh recovery evidence, then execute the controlled cutover. Fresh
   pilot tests must not create business records or send email to real customers.
3. Apply the reviewed central-access proposal and verify allowed and denied
   actions. Production access has not been changed during this preflight.
4. Before enabling KYC uploads, provision and verify the private production
   `tenant-verification` bucket using the explicit production target. Its read-only
   lookup currently returns 404. Do not use the public branding bucket instead.
5. Activate KYC separately: approve requirements, nominate collectors and
   independent reviewers, and explicitly choose checkpoint rules. Do not infer
   these choices from central collections access. KYC remains unconfigured for
   Ewissen; checkpoints default Off and accepted evidence retention indefinite.

Ignored evidence: `tmp/p13s-production/preflight.json`,
`pilot-access-private.json`, `access-proposal-private.json` and
`storage-preflight.json`. No production database, permission, storage or deployment
mutation was performed in this preflight.
