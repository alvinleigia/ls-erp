# P13S - private facts, submission and independent review

Local implementation; no hosted deployment, activation, grants or client-data
changes. This builds on the policy/case and private-evidence increments.

## Workflow and boundaries

Customer/account > Verification has Evidence and Facts and review subtabs.
The private panel loads on first use and remains mounted so tab switches preserve
unsaved facts. Opening a record does not submit or approve anything.

Collectors enter typed private facts for a configured participant role and select
accepted files. All applicable facts and document types must be complete. Country
values use the existing country catalogue; dates must be real ISO calendar dates;
emails, values and counts are bounded. Unknown/duplicate facts/files are rejected.
No customer master, transaction correspondence or tax identity is overwritten.

Submission freezes an immutable, sequential revision and its exact policy, role
and native evidence references. A later revision requires a private reason.
Files are referenced, not copied. Deferred native validation rejects missing or
mismatched evidence; composite foreign keys prevent cross-customer selections.
Selections cannot be extended after the submission transaction commits.

An independently authorised reviewer inspects the submitted facts and selected
evidence, then approves or requests corrections. Neither the submitter nor anyone
who uploaded/finalised selected evidence can approve, including administrators.
The review checkbox is a human acknowledgement, not government verification or
an electronic signature. Explicit authority plus the source's current visibility
is required. Corrections create another submission rather than editing history.

Approvals can be revoked with a separate permission and reason. Each decision is
append-only. Approval validity is calculated from the database clock and pinned
policy; callers cannot set its timestamps or expiry. Revocation retains the
approval. No decision or submission may be deleted or overwritten.

Latest-revision status is In progress, Under review, Changes required, Verified,
Expired, Revoked or Review required after policy changes. A new submission
supersedes the previous status and requires fresh approval; an older approval is
never silently revived. Historical approved decisions remain historical even
after expiry or a policy change. An outdated-policy submission cannot be approved.
Verdicts apply to the submitted role and policy, not every transaction/role.

The panel shows the current frozen revision and the latest ten revision summaries,
including private correction/review reasons and approval/revocation history.
Earlier complete revisions remain retained in the native tables. A paginated
historical revision browser and operational review queue are subsequent UI work.

## Access and persistence

- `verificationSubmissions.read/create`: private facts/history and submission.
- `verificationReviews.read/approve/cancel`: reviewer actions; also require
  submission Read, evidence Read, case Read and canonical source visibility.
- `verificationUploads` and `verificationEvidence.read` retain their separate
  existing boundaries. A collector can select their own accepted uploads without
  gaining download access to colleagues' files.
- Ordinary case/directory readers receive no private facts, reasons or revision
  queries. Their case response marks review status unavailable; it does not infer
  a verification verdict. External logins are excluded from the whole module.
- Fresh authority is resolved under the exclusive tenant lock before the
  operational mutex. Stale policy/revision/review inputs fail; simultaneous
  submissions or decisions accept one. Forced RLS and native guards independently
  enforce visibility, actor identity, immutability and review separation.
- General audit records contain IDs, revisions, policy versions, counts and
  decision codes only. No private facts, filenames, paths, checksums or reasons
  are copied into general audit. Native row errors are sanitised before API logs.

Migration `20261111000200_verification_submission_review` adds three empty native
tables and a composite evidence key. It extends only the explicit native permission
whitelist. It does not grant profiles, activate modules, backfill existing cases
or modify correspondence, partners, bookings, snapshots, documents or payments.
The existing encrypted database/storage recovery captures these rows and their
retained evidence; no extra per-submission file archive is created.

## Remaining scope

This is internal verification, not automated government validation, AML screening,
malware scanning or a legal/compliance determination. No new KYC booking, allocation,
document or payment block is enabled. Next: reusable participant status projections,
warning/required checkpoints and frozen acceptance proofs; then retention/holds,
operational history/queue controls and release/recovery acceptance. Ewissen
activation and any required-transaction rules need their own rollout decision.

## Verification

- 123 distinct automated regression checks passed: the preceding 105 checks plus
  15 submission/review integration checks and three status/expiry contract checks.
  Coverage includes typed/native validation, deferred completeness, cross-case
  references, independent reviewer/upload separation, stale/concurrent revisions,
  reasoned corrections/revocation, policy changes, RLS/Restricted visibility,
  module/external denial, audit rollback and native-error sanitisation.
- Historical migration rehearsal: 107 checks passed, including forced rollback
  and exact preservation of all 170 preceding tables. No activation/grant backfill.
- Four production-build browser workflows passed: policy administration/read-only
  access, real direct evidence upload above 4.5 MB and authorised download, and the
  full private submission/correction/approval/revocation workflow. The evidence
  regression's former literal status expectation was updated to assert that an
  ordinary collector's private review status remains unavailable.
- The private panel loads only after its tab is first opened, avoids duplicate
  hidden evidence controls on initial load, and preserves draft values across
  subtab switches. Desktop/mobile screenshots were inspected; mobile overflow
  was checked. Production build, TypeScript, targeted lint and whitespace passed.

All fixtures were disposable loopback businesses; no pilot business was used.
Ignored logs: `tmp/p13s-partner/submissions-regression.log`,
`submissions-final-native.log`, `submissions-rehearsal.log`,
`submissions-build-final.log`, `submissions-browser-release.log` (all four flows), and
`tmp/industry-release/ls-erp-sales-orders-c8db40b64ef1.log`.
Screenshots: `test-results/local-access/verification-submissions-desktop.png`,
`verification-submissions-mobile.png`, and the evidence/policy captures.
