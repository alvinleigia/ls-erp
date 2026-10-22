# Issued quotation PDFs

Saved quotation revisions continue to store immutable data snapshots. Saving or
previewing a draft does not store a PDF. Preview PDFs display a draft notice.
Tenant users with quotation read, edit and export permissions can select **Issue
& Download** and confirm the selected revision. The exact PDF is archived once.
Subsequent downloads reuse it, even after renderer, logo or quotation changes.
Editing creates a new draft revision; older issued versions remain available.

The UI disables issuance while editing to avoid issuing stale unsaved content.
Read/export users can download an issued version without edit permission.
Every request rechecks module activation, tenant identity and record scope.
Issuance records actor, timestamp, size and SHA-256 checksum in the revision and
an audit event. Existing revisions remain unissued; they are not bulk rendered.
This does not retroactively reproduce files downloaded before archiving existed.

## Storage

Use the existing server-only Supabase credentials and a separate private
`tenant-documents` bucket, restricted to `application/pdf`, maximum 10 MiB.
This document limit is independent of the branding image upload/optimization limits.
Do not grant public or browser write policies. Files use
`tenant-id/quotations/quotation-id/revision/random-uuid.pdf` and are never overwritten.
The database stores metadata, not PDF bytes.

Download authorization precedes a 60-second signed URL. The URL is a temporary
bearer link: anyone possessing it can use it until it expires. Responses carrying
the redirect are not cached. Do not log or retain these signed URLs.

Rendering and uploads run outside database transactions. Finalization rechecks
permissions and locks the revision. Concurrent issuers keep one committed file;
known losing candidates are removed. Ambiguous commit failures retain their
candidate for recovery rather than risk deleting the issued document. Retries
return the committed archive. A missing archive fails instead of regenerating a
potentially different PDF.

The additive migration permits only the initial archive attachment on a revision.
Database triggers continue to prohibit snapshot changes, archive replacement and
revision deletion. Issued documents are retained; no automatic expiry is added.
Include storage objects in recovery backups alongside the database.
Use the [storage recovery companion](STORAGE_RECOVERY.md) to capture and verify
the two application buckets with the matching database backup.

Scope: quotation issuance and archived downloads. Appointment invoices retain
their existing runtime rendering and saved branding; invoice issuance is separate.

## Verification

`node scripts/test-branding.cjs` runs the isolated migration and document regression
suite, including concurrent issuance, repeat requests, new revisions, database
immutability, storage failures, tenant isolation and permission/module denials.
Hosted validation uses only the authorized synthetic staging tenants.
