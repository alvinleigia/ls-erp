# P13S accidental duplicate verification uploads

This adds a separate DUPLICATE purpose to the existing controlled disposal flow.
It does not publish or shorten retention, grant staff permissions, or remove any
existing upload automatically. The feature is shared across customer verification
subjects and industries.

An internal tenant administrator opens a customer's Verification > File management.
Remove documents offers Remove duplicate only for eligible files. The confirmation
identifies the older original to keep,
requires a private reason and permanent-removal acknowledgement, then uses the
existing quarantine, removal and recovery process. Returning to Documents reloads
the accepted-file list. Soniya's Collector access cannot delete originals.

Matching uses accepted server checksums, byte count and MIME type, within the same
tenant, customer case and document category. A filename match is insufficient.
Only a newer duplicate may be removed; ordering uses creation time and ID in C
collation. Any saved submission selecting the target, active case hold or accepted
transaction proof blocks removal. A submitted older original may be preserved.
Native guards repeat these checks at request, execution/reconciliation and
completion, independently of the UI and service. Tenant locking serializes writes.

The older original is referenced by a same-tenant/case foreign key. Its own disposal
is blocked while a duplicate request is PENDING or DELETING. Storage inspection
checks that the keeper exists and its checksum/size match before removal, and again
before completion. Missing/corrupt/unknown keeper storage stops removal. A pending
request remains cancellable; uncertain destructive outcomes remain quarantined
until versioned reconciliation after the existing retry interval.

On completion only the selected duplicate's object is removed. Its metadata is
redacted through the existing native DISPOSED tombstone. The request retains its
purpose, keeper ID, private reason, actors and immutable attempt history. General
audit retains identifiers/states only. Existing recovery tooling already excludes
disposed objects and refuses unresolved DELETING requests; the same rules apply.
Existing backups/downloaded copies retain their separate lifetimes.

Migration `20261117000100_verification_duplicate_removal` adds a purpose defaulting
to RETENTION and an optional keeper reference. Retention policy references become
nullable only for DUPLICATE; a native CHECK requires the correct purpose/fields.
Existing retention requests keep their purpose, policy and lifecycle. No evidence,
submission, permission or tenant setting is changed by the migration. Apply the
migration before deploying the application; this is migration 158.

Validation and hosted release status are recorded in MODULAR_PLATFORM.md. The
disposable runner includes forced migration rollback/preservation, duplicate
service/native checks and existing verification regressions. Browser coverage uses
synthetic local uploads, confirmation/cancellation and desktop/mobile captures.

Validation on 2026-11-17: 192 full verification checks passed; final focused rerun
passed 62 checks (overlap) and both real browser flows. The broader browser run's
eight other passing scenarios remain applicable; its new duplicate test's ambiguous
status locator was corrected and passed in the final focused run. Production build,
Prisma generation, targeted lint and whitespace checks passed. Screenshots under
`test-results/local-access/verification-duplicate-confirm-{desktop,mobile}.png`
were inspected. The final browser test also opens retention after the first upload,
returns to upload a duplicate, then removes it without a manual panel refresh.

Run `node scripts/test-sales-orders.cjs --verification` for the full native suite,
or `node scripts/test-sales-orders.cjs --verification-duplicates --browser` after
a production build for the focused suite and real browser flows. These commands
create isolated disposable loopback databases and synthetic file storage.

Evidence: `tmp/p13s-duplicates-final-tests.log` (full native checks and broader
browser results), `tmp/p13s-duplicates-targeted-tests.log` (final 62 checks/two
flows), `tmp/p13s-duplicates-build.log`, `tmp/p13s-duplicates-lint.log`, and
`tmp/industry-release/ls-erp-sales-orders-95c03a725933.log`. This local run did not
deploy. Subsequent staging migration and hosted acceptance passed; see
`P13S_IMAGE_STAGING_ACCEPTANCE.md`. The production customer's duplicate remains
untouched pending its production release.
