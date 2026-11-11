# P13S controlled verification-original disposal

Local implementation, 2026-11-11. This extends the read-only retention milestone
in `P13S_VERIFICATION_RETENTION.md`. It does not activate KYC or run a purge for
any existing tenant. There is no background accepted-file deletion job.

## Authority and eligibility

Only active internal tenant administrators can manage disposal. The shared
`verificationDisposals` resource declares Read/Create/Approve/Cancel; native
authority additionally requires the administrator account role, private evidence
Read, case Read, retention Read, and enabled CRM/customer-verification modules.
Granting a manager these profile capabilities does not grant disposal authority.
Canonical customer scope, same-tenant/case foreign keys and forced RLS apply.

An original must be accepted, past its finite retention period, and unreferenced.
Active preservation holds, every saved submission (including historical/revoked
revisions), and accepted transaction proofs take precedence. A transaction proof
protects all originals for its case. Indefinite/unpublished retention is closed.
Facts, submissions, reviews, transaction proofs and issued PDFs are never erased
by this workflow. Abandoned-upload cleanup remains a separate operation.

## Administrator flow

Open the customer/account's Verification tab, then Retention and holds. Eligible
files offer Review disposal. Review the original, provide a private reason and
check the explicit permanent-removal acknowledgement before confirming. The
preview binds the tenant, original, checksum, size, accepted instant and retention
version. A policy change requires a fresh preview.

Confirmation creates a durable PENDING request and quarantines the original.
Downloads and new submission selection are denied, including administrator
downloads. A pending request can be cancelled, restoring availability. A unique
request key makes retries idempotent; one non-cancelled request per original is
enforced natively. A network interruption leaves the request visible for recovery.
All active requests and the latest ten requests are shown; earlier native history
remains retained.

Before starting removal, inspect the exact private object and check size/checksum.
Only an authoritative object-not-found response counts as absence; denied access,
malformed responses, timeouts and unknown failures do not. Recheck current
authority, retention and references under the tenant lock after storage I/O.

## Irreversible start and recovery

Commit DELETING before sending the external removal request. This state cannot
be cancelled or restored to PENDING, because an external DELETE cannot roll back
with a database transaction. A failed/uncertain response or failed completion
audit leaves the request quarantined. Reconciliation is permitted after the
database-issued three-minute attempt interval; each storage HTTP request has a
shorter timeout. Concurrent attempts use expected versions and native transitions.

Reconciliation inspects only the immutable original path. If present, its size and
checksum must still match before retrying deletion. If absent, finalize the
tombstone without a second object deletion. Always freshly check authority. If
authority is revoked after removal, an authorised administrator must reconcile
later. Never restore or reuse the path to resolve an uncertain result.

New case holds and accepted transaction proofs fail with a conflict while an
irreversible removal is in progress; they cannot silently promise preservation of
a file already being removed. Holds can still be placed while PENDING and block
the initial start. Native submission-selection guards reject quarantined files.
Once removal completes, future holds/proofs remain possible for the remaining
records. Money recording and already-issued PDF downloads are independent.

After storage confirms absence, atomically mark COMPLETED, append the native event,
record the ordinary audit, and redact filename/size/checksum from the evidence
row. A narrow native trigger permits only this redaction. The DISPOSED tombstone
retains opaque path/identifiers, content type and provenance/time metadata;
private reason and actor history remain retained. No filename, identity values,
reason, signed URL or storage bytes enter the ordinary audit. Terminal requests
and native attempt events cannot be edited/deleted. Previously issued signed
download links expire naturally; already downloaded/cached copies cannot be erased.

## Backups

Existing encrypted backups have their own retention/expiry; active-storage removal
does not immediately erase those copies. No backup-expiry automation is added here.
`document-recovery.cjs` refuses to certify a recovery inventory while DELETING
requests remain. Completed tombstones are negative references: a storage manifest
containing their originals fails reconciliation. Before restoring an older backup,
apply the current disposal ledger to the recovery process; verifying only an old
database/old manifest pair cannot detect later disposals. Keep the current ledger
with recovery evidence and reconcile restored storage before reopening access.

## Migration and verification

Migration `20261111000500_verification_controlled_disposal` adds two empty tables,
forced RLS, same-case keys, guarded transitions and append-only events. It extends
the closed capability resolver and accepted-evidence state constraints. No earlier
migration, existing assignment, module flag, customer, booking or payment is changed.
Forced rollback/reapply and exact preceding-table preservation are part of the
historical verification runner.

Automated coverage includes preview/policy binding, independent administrator
authority, tenant/external boundaries, quarantine, cancellation, holds, saved
submission/transaction references, checksum mismatch, concurrent actions,
authoritative absence, storage failures, authority/module loss during I/O,
download-link races, audit rollback, native mutation denial, recovery tombstones,
and browser confirmation/cancellation/completion on desktop/mobile. Tests use only
owned disposable loopback data and an isolated storage transport.

Repeat with `node scripts/test-sales-orders.cjs --verification --browser` after a
production build. Hosted staging acceptance and production release are separate
steps; this milestone does not claim those deployments or tenant activation.

Local verification evidence: `tmp/p13s-partner/disposal-rehearsal.log` (176 passing
checks plus forced rollback/reapply), `disposal-transaction-final.log` (31 passing
disposal/checkpoint checks, including one additional acceptance conflict),
`disposal-browser.log` (seven passing flows), `disposal-build.log` and
`disposal-types-final.log`. Desktop/mobile captures under
`test-results/local-access/verification-disposal-*.png` were inspected.

Additional sales-order/catalog/reservation/order-document regression: 53 checks
passed (`tmp/p13s-partner/disposal-orders-regression.log`). Combined distinct
automated coverage is 230 checks (177 verification/resource/recovery/CP checks
including the additional checkpoint scenario, plus 53 sales-order regressions),
with seven browser flows. TypeScript, targeted ESLint and whitespace checks passed.
