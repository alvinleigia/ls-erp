# P13S image preparation and duplicate removal: staging acceptance

Verified on 2026-11-17 against staging source
`4a94758b8edb6016b5185d4eecadd479cfd3d3d9`, deployment
`dpl_Gd2HdJ4aLupfxFtZhpJpmhFYezsM` at
`https://ls-erp-staging.vercel.app`.

The source was committed locally and deployed from a tracked-source snapshot.
No Git branch was pushed. Environment files, browser sessions, build outputs and
the user's untracked reference documents were excluded from the upload. Registered
project/branch/database guards passed. The staging build applied migration 158;
read-only history verification found all 158 applied and no pending migrations.

## Hosted results

Both acceptance scenarios passed using isolated, newly provisioned staging tenants
and normal application APIs. Storage operations used real private staging storage,
without SQL seeds, storage mocks, hosted resets, production sessions or email sends.

- Shared image preparation: natural-resolution PNG cropping, transparency,
  quarter-turn rotation/reset, phone JPEG orientation and normalized JPEG output.
- Crop/Cancel/Use original create no upload reservation. Unedited PNGs and PDFs
  retain exact bytes. PDFs have no crop action. Corrupt images cannot be decoded;
  over-limit inputs are rejected on Upload before any reservation.
- A valid PNG above 4.5 MB and below 5 MB uploads directly to storage, finalizes,
  downloads through the authenticated endpoint and retains its byte checksum.
- The collector cannot dispose of evidence. Administrator confirmation requires
  review and a reason; cancellation preserves both files. Removing an exact
  duplicate preserves the older original and its checksum, records a completed
  tombstone and makes the removed original unavailable. Retention stays version 0.
- Independent corrections/approval retain two submission revisions. Saved evidence
  remains protected from duplicate removal and downloadable by the reviewer.
- Combined regression: enquiry, won opportunity, CP correction, quotation, order,
  participant KYC checkpoints, unit allocation, issued document, revocation,
  immutable PDF retrieval, payment/receipt and idempotent retries. The synthetic
  balance is 30 paid and 70 outstanding against an order for 100.

Desktop/mobile crop and duplicate-confirmation captures, the reviewer page and
combined sales-order captures were inspected. TypeScript, targeted ESLint and
whitespace checks passed. No application defect was found in these scenarios.
The first image runs stopped on test assertions: oversize rejection happens on
Upload rather than disabling its button, and Next.js adds a separate route-announcer
alert. The test now checks the actual rejection and scopes the message locator.
The final image run passed all six named steps without application changes.

## Isolation and evidence

Production alias `erp.ewissen.in` was read before and after testing and still points
to `dpl_9XnpZcX8pUHGkevgz3khsVcZxBCz`. Its database remains at 157 applied
migrations; migration 158 is pending there. No production records, uploads,
permissions, retention settings or deployments were changed. In particular, the
previously identified production duplicate was not removed by these tests.

Four synthetic staging tenants were created across the runs. The two incomplete
runs were suspended through the platform API. The two successful tenants remain
available for inspection. Audit records and accepted evidence were preserved;
no tenant reset or retention bypass was used.

Ignored local evidence (includes private fixture receipts; do not commit it):

- `tmp/p13s-staging/deployment.json` and `image-acceptance-isolation.json`.
- `tmp/p13s-staging/qa-p13s-48c8c0f2-acceptance.json`: combined acceptance.
- `tmp/p13s-staging/qa-p13s-c795c2d5-image-acceptance.json`: six image/review steps.
- `tmp/p13s-staging/crop-hosted-tests.log`, `crop-hosted-rerun.log` and
  `crop-hosted-final.log`: original attempts and final passing result.
- `test-results/staging-access/`: final image screenshots and passed run status.
- `tmp/p13s-staging/first-run-artifacts/`: combined acceptance screenshots.
- `tmp/p13s-staging/hosted-test-final-types.log`: final TypeScript check.

Repeatable coverage is in `tests/staging-access/verification-image-preparation.spec.ts`
and `tests/staging-access/p13s-acceptance.spec.ts`. The existing hosted fixture checks
the staging deployment receipt, alias, database reference and unchanged production
alias before provisioning. It requires `RUN_P13S_STAGING_WRITES=1`. Keep generated
credentials, sessions and signed storage URLs out of reports and source control.
