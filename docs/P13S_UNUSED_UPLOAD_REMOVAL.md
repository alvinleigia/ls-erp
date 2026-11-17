# P13S unused verification upload removal

Internal tenant administrators can remove an accidentally uploaded original
before it has ever been selected in a saved verification submission. Approval
status is not the cutoff: even an undecided or rejected saved submission protects
its selected files. Preservation holds, accepted transaction proofs and a file's
use as an active duplicate keeper also block removal.

Open the customer, then Verification, Evidence, Manage uploaded files. An eligible
original offers Remove unused upload. Review the file, enter a private reason and
acknowledge permanent removal before confirming. Keep file cancels the preview
without creating a request. Soniya's Collector access remains unchanged; Anil as
tenant administrator can perform removal. Removing the last unused original is
allowed, and a prepared replacement can then be uploaded normally. No retention
configuration needs to be published or shortened.

UNSUBMITTED is a third purpose in the existing disposal ledger. It has no keeper
or retention policy reference. Exact duplicate and expired-retention removal
retain their existing checks and UI priority. All purposes use the same durable
quarantine, irreversible removal, retry/reconciliation, immutable attempt history,
minimal tombstone and storage-integrity checks. Ordinary audit contains no private
filename, evidence bytes or removal reason. Backups follow their own lifetime;
restores must apply the current disposal ledger before exposing older objects.

Migration `20261117000200_verification_unused_upload_removal` is migration 159.
It extends the closed purpose constraint and adds a native eligibility helper and
guard. The original authority/version/tenant-lock/lifecycle trigger is preserved.
The added guard runs after it for every non-cancelled unused-file transition,
including irreversible start, completion and reconciliation. Existing submission,
hold and checkpoint guards continue to prevent new references during removal.
No customer files, saved submissions, permissions, retention or activation settings
are changed by this migration. Apply it before deploying the new application.

Local verification commands:

```
npm.cmd run build
node scripts/test-sales-orders.cjs --verification-unused --browser
```

The runner uses a disposable loopback database and synthetic storage. It includes
forced migration rollback and preservation, service/native unused-removal tests,
duplicate/retention/checkpoint/recovery regressions and real browser confirmation,
cancellation, replacement and independent-review flows. Hosted acceptance uses
`tests/staging-access/verification-unused.spec.ts`, normal application APIs, owned
synthetic tenants and the separate staging storage project. It never seeds or
resets a hosted database. Release results are recorded in MODULAR_PLATFORM.md.

Production removal of the customer's earlier images is a separate operation.
This implementation does not automatically delete any existing upload.

Validation on 2026-11-17: the final local run passed 73 native checks and all five
browser flows. Build, TypeScript, targeted ESLint and whitespace checks passed;
confirmation captures were inspected at desktop and mobile widths. Staging source
`dc68fdd` passed both hosted acceptance tests with migration 159 and real private
storage. Existing crop, exact duplicate, submission, independent review and
correction flows passed alongside unused-file removal. Production is unchanged.
