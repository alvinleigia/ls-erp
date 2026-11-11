# P13S private customer verification evidence

Implementation date: 2026-11-11. Local staging branch only; not committed,
pushed, deployed or enabled for any hosted tenant. This continues the foundation
milestone without adding review approval or booking gates.

## Delivered

- Shared person/business Verification tabs, visible only when the module is
  enabled and Case Read is granted. Each co-applicant remains their own subject.
- Existing configured document choices, authorised case start, PDF/JPEG/PNG
  original uploads, retry validation, pending cancellation and evidence download.
- Uploads go directly to private Supabase Storage using one-path signed tokens.
  Server validation reads the original, confirms declared size and real type,
  decodes images within a pixel limit, parses unencrypted PDFs up to 100 pages,
  and records SHA-256. No re-encoding or public preview is performed. This is
  structure/type validation, not a malware scan or government identity check.
- 5 MiB maximum/file, 20 uncleaned files/case, 100 unaccepted files/business.
  Reservation/finalisation are separate from network I/O, with fresh authority,
  policy, active subject and expiry checks before acceptance. Concurrent finishes
  are idempotent. Accepted originals and their metadata cannot be overwritten.
- verificationUploads Read/Create/Cancel is distinct from verificationEvidence
  Read. Collectors see their own pending metadata; private filenames/downloads
  need the evidence grant plus current case/customer access. External identities
  stay excluded. Existing profiles, sales assignments and scopes are unchanged.
- Authorised downloads verify exact bytes/checksum, recheck access after I/O,
  audit only IDs and issue 60-second attachment links. The ERP page stays open.
  A previously issued bearer link stays usable until it expires.
- Expired cleanup is an explicit tenant-admin action, at most 20 files/batch.
  Supabase upload tokens last two hours; reservation cleanup waits three hours.
  Database-clock expiration marks an unaccepted upload abandoned before object
  deletion. Failed removals/metadata commits remain retryable. Accepted files
  never enter this cleanup path. No automatic destructive retention job is added.
- Storage recovery captures the private evidence bucket when present. Accepted
  evidence references/hashes are reconciled against database recovery inventory.
  Recovery tests include encrypted round-trip and private-bucket/reference denial.

## Provisioning and rollout

No storage bucket was created in a hosted project during implementation.
An operator must explicitly check or create its private bucket before activation:

```powershell
# Replace PROJECT_REF with the intended staging project reference.
node scripts/verification-storage.cjs --env .env.new-vercel-staging --project PROJECT_REF
# Explicit creation only if the bucket is absent:
node scripts/verification-storage.cjs --env .env.new-vercel-staging --project PROJECT_REF --create
```

The script checks exact origin/project, private status, 5 MiB limit and MIME
allow-list. It does not silently modify an existing bucket. Local demo storage
setup registers the same private bucket. No new dependency or storage provider
is introduced. Keep server keys out of browser configuration and source control.

Migration `20261111000100_verification_private_evidence` follows the two local
P13S migrations. It adds an empty native tenant/case/policy/user-bound table,
forced RLS, immutable file identity, capacity and state guards. No flags, grants,
customer data, correspondence, snapshots, documents or payments are backfilled.

## Verification

- 105 automated regression checks passed, including file contracts/real formats,
  native RLS, separate grants, foreign/external denial, policy changes, revoked
  authority, corrupt/tampered files, concurrent finalisation, audit rollback,
  native-error sanitisation, cleanup failure/retry and encrypted storage recovery.
- Historical migration runner: 89 checks passed (a subset of the above), with
  forced rollback and exact preservation of all 169 preceding tables.
- Browser verification uses isolated synthetic customers/businesses and a local
  external-storage transport. It exercises a real direct upload above 4.5 MB,
  validation/rejection, collection without evidence Read, authorised attachment
  download without leaving the record, default-off tab hiding and policy settings.
- All three production-build browser workflows passed. Desktop/mobile captures
  were inspected, and mobile page overflow was checked. Production build,
  TypeScript, targeted lint and whitespace checks passed.
- The five existing local-storage isolation/credential checks also passed. A
  focused repeat of the evidence browser flow confirmed the stable mobile capture.

```powershell
node scripts/test-sales-orders.cjs --verification
npm.cmd run build
node scripts/test-sales-orders.cjs --verification --browser
```

Ignored evidence: `tmp/p13s-partner/evidence-regression-final.log`,
`evidence-native-final.log`, `evidence-build-release.log`,
`evidence-rehearsal-final.log`, `evidence-browser-final.log`, and
`tmp/industry-release/ls-erp-sales-orders-d97747e97613.log`.
Screenshots: `test-results/local-access/verification-collector-desktop.png` and
`verification-reader-mobile.png`.

## Next increment

Typed private facts, immutable submissions/evidence selections, explicit reviewer
authority, independent approval, correction/replacement history, expiry and compact
participant statuses. Then reusable warning/required checkpoints, frozen acceptance
proofs, retention/holds and complete release/recovery acceptance. No KYC approval
endpoint, government validation or new booking/payment block is delivered here.

The subsequent facts/submission/independent-review implementation is recorded in
`P13S_VERIFICATION_REVIEW.md`. This evidence milestone's original results above
remain unchanged; participant checkpoints and retention are still separate work.
