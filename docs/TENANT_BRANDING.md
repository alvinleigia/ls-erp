# Tenant branding

Settings → Branding is available to tenant administrators with Business settings
read/edit permission. Upload a still PNG, JPEG or WebP up to 2 MiB. The server
decodes the image (maximum 20 megapixels), applies orientation, removes metadata
and produces a PNG for documents (up to 1200 × 1200, preserving aspect ratio)
and a WebP for the sidebar (up to 300 × 160). Neither is enlarged; each is capped
at 512 KiB. Small originals show a print-quality warning. Preview both light and
dark backgrounds before saving. One primary logo serves the application and new
documents; a separate document override is not added to tenant settings yet.

## Storage setup

Use separate Supabase projects for staging and production. Configure server-only
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`).
Never prefix these with NEXT_PUBLIC or commit their values.

Create a public-read `tenant-branding` bucket with a 524288-byte limit and allowed
MIME types `image/png`, `image/webp`. Do not grant anonymous or authenticated
browser upload/update/delete policies. The application uses its own authentication;
its backend checks tenant identity and current permissions before storage writes.
Only public logos belong in this bucket, never private attachments.

Files use `<tenant-id>/<random-uuid>/document.png` and `sidebar.webp`. The database
stores paths, dimensions and byte counts. Files are never overwritten. Saved
assets are retained because historical documents may refer to them. Removal from
branding changes the current selection only. Known rolled-back uploads are
removed; files from ambiguous database failures are retained for later review.
Database recovery must include this storage bucket, not just PostgreSQL backups.
See [storage recovery](STORAGE_RECOVERY.md) for encrypted capture, verification
and protected local reconstruction alongside the database backup.

## Documents and rollout

The additive migration introduces branding metadata/version on AppSetting and an
invoice branding snapshot on AppointmentOrder. Existing orders retain their current
tenant name and no logo. Newly created orders capture the configured name/logo;
later edits and downloads use that snapshot. New quotations capture the logo path;
later revisions retain it. A quotation's explicit PNG override takes precedence.
Previously saved quotation snapshots remain unchanged. Their existing per-document
PNG upload limit remains 290 KB; the new tenant logo uploader accepts 2 MiB inputs.

Deleting a saved storage object externally can break historical PDFs. Missing
saved images produce an explicit error instead of silently changing the document.
Changing branding does not change financial calculations, tenant account names,
industry fields or existing document snapshots.

Run `node scripts/test-branding.cjs` for isolated migration, image, tenant-isolation,
settings, quotation and invoice regression checks. After `npm run build`, append
`--browser` for local UI/access checks. These use a disposable PostgreSQL container
and synthetic accounts. Local storage service tests use a deterministic storage
boundary; actual uploads/downloads must also be verified in staging.

## Verification — 2026-10-19

- 95 isolated database/module/image checks passed; additional proxy-origin,
  storage-client and PDF-embedding checks passed separately.
- Production build and TypeScript passed. Desktop/mobile local branding UI,
  save persistence, staff denial and cross-tenant isolation passed.
- Inspected the mobile settings screenshot and logo placement in quotation and
  invoice PDFs. The existing receipt's narrow numeric columns remain unchanged.
- Actual staging Supabase upload/download/public delivery passed; the temporary
  storage probe was removed. The public bucket has no browser write policies.
- Hosted staging upload/replacement/removal, saved quotation logo retention and
  desktop/mobile checks passed at b0fa998. Production was unchanged.
