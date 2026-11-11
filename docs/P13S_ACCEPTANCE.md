# P13S combined acceptance

The shared acceptance workflow is `tests/helpers/p13s-acceptance.ts`. It uses public
application APIs and browser pages, without database seed/reset helpers. The local
entry point provisions only its guarded disposable loopback fixture. The hosted
entry point provisions a new synthetic staging tenant through the platform API.
Never substitute an existing client tenant or production URL.

## Covered sequence

1. Create a generic issuing company/office and separate collections/reviewer
   profiles. Real Estate is disabled to verify the shared industry boundary.
2. A non-admin collections manager selects an existing CP without private
   collaborator-directory access, qualifies an enquiry, converts it and adds a
   co-applicant. Mark the opportunity Won, save quotation and order snapshots.
3. Correct the CP after Won. Verify the salesperson, source enquiry attribution
   and saved order snapshot are unchanged.
4. Enable Required verification checkpoints only for this new QA tenant. Block
   confirmation while either applicant lacks approval. Upload synthetic originals,
   submit typed facts and independently approve each role. The collector cannot
   approve. Confirm, reserve and allocate the generic catalog unit.
5. Publish QA templates, issue an order PDF and verify idempotent retries and
   private archived bytes. Revoke one applicant's approval. New order-document
   issuance must fail, while the archived original remains byte-identical.
6. Record a synthetic partial payment with idempotent retry and issue its receipt
   despite the later verification revocation. Confirm paid 30/outstanding 70.
   Inspect the desktop document view and mobile participant-verification view.

No email is sent, no payment gateway is called, and no real identity information
is used. Broader negative cases, retention/disposal and access boundaries remain
covered by the focused P13S integration and browser suites.

## Local run

After a current production build, use an owned disposable loopback database:

`P13S_VERIFICATION_STORAGE_TEST=1` and the local Playwright configuration with
`tests/local-access/p13s-acceptance.spec.ts`. The combined test transport keeps
verification originals and document archives separate, while the real routes,
authentication, native RLS, services, PDF renderer and checksums are exercised.

The combined local flow and three transport/CP regressions passed on 2026-11-11.
TypeScript and targeted lint passed; desktop/mobile screenshots were inspected.
Evidence is ignored under `tmp/p13s-staging` and `test-results/p13s-combined`.

## Hosted staging gate

The hosted entry is `tests/staging-access/p13s-acceptance.spec.ts`, explicitly opted
in with `RUN_P13S_STAGING_WRITES=1`. It requires a verified staging deployment
receipt, exact source SHA/project/alias agreement and an unchanged production
deployment. It validates the registered staging Supabase project and application
origin before login. QA domains must belong to that exact staging project.

New tenants, aliases and private access receipts are recorded under ignored
`tmp/p13s-staging/qa-p13s-*.json`. Preserve them for troubleshooting and explicit
cleanup. Failed test setup must never be reported as a passed hosted workflow.
Do not activate KYC, publish requirements, change CP assignments or add profiles
to Ewissen as part of this test.

Hosted acceptance results and deployment identifiers are recorded separately
after the staging release. Production rollout remains a separate controlled step.

## Hosted result (2026-11-11)

Staging application commit `ccb486aef32d5c137ad5752d662f4c8fa53e1ca6` is READY at
`ls-erp-staging.vercel.app` (deployment `dpl_9tgxeKvQyTxkh42iidHRYavY693Z`).
All seven migrations applied: 157 total. Before QA writes, exact row/count hashes
for all 166 existing staging tables matched; 13 added tables were empty and forced
RLS was enabled. No existing tenant was activated for KYC. The pre-deployment
staging database backup was encrypted; key round-trip, archive read and migration
history presence were verified. This does not claim a new full recovery rehearsal.

The shared hosted flow passed (46.2 seconds), using real private Supabase originals
and archived PDFs. Two independent applicant approvals permitted confirmation and
allocation. Later revocation blocked a replacement order document while preserving
the issued PDF checksum and allowing payment/receipt recording. Exactly 30 paid
and 70 outstanding were verified, including idempotent document/payment retries.
Desktop/mobile captures were inspected. No emails or gateway payments were sent.

The initial hosted run correctly rejected a hard-coded order date: the new tenant
used America/New_York, whose business date was still the previous day. The test
now uses the normal sales-order context date for the order and payment. No date
validation or application permission was weakened. The corrected local run passed
as well. This test-only follow-up and acceptance notes are kept in the local
checkout; the deployed application source is unchanged from the SHA above.

Two clearly labelled synthetic staging tenants remain with ignored private setup
receipts for inspection and explicit cleanup. The first contains the interrupted
pre-order setup; the second completed acceptance. No pilot tenant was used.
Evidence: `tmp/p13s-staging/hosted-acceptance-final.log`, `deployment.json`,
`database-verification.json`, `production-unchanged.json` and the QA acceptance
receipt. Screenshots: `test-results/p13s-staging-final`.

The final production read-only check confirmed its alias was unchanged, with 150
applied migrations and zero P13S migrations. Production release, Ewissen profile
grants and tenant KYC activation are still separate, unperformed actions.
