# Logo and quotation archive recovery

The application database backup alone does not contain Supabase object bytes.
Keep the database archive and a storage companion covering `tenant-branding`
(public logos) and `tenant-documents` (private issued quotation PDFs).

`scripts/storage-recovery.cjs` only reads Supabase. It never creates a bucket,
uploads, overwrites or deletes a hosted object. Local recovery is deliberately
separate from restoring a database or uploading to a replacement Supabase project.

## Capture and verification

1. Take and verify the application database backup using the reviewed release
   procedure. Retain its encrypted archive, wrapped key, source evidence and
   `ID-backup.json` receipt. The receipt must identify the Supabase project,
   archive checksum, encrypted checksum and creation time.
2. Within one hour, capture storage from that same project. Supply an explicit
   environment file and project reference; there is no implicit `.env` fallback.
   The output directory must be new and its parent must already exist.

```powershell
node scripts/storage-recovery.cjs backup --env .env.new-vercel --project PROJECT_REF --database-backup tmp/catalog-release/ID-backup.json --out backups/storage/NEW_BACKUP_ID
node scripts/storage-recovery.cjs verify --dir backups/storage/NEW_BACKUP_ID
```

The command verifies the encrypted database archive checksum and presence of its
wrapped key. It does not replace a database restore rehearsal. It downloads every
object in both buckets, including historical and currently unreferenced assets.
Listings are recursive and paginated. It records paths, content types, bucket
privacy/limits, sizes and SHA-256 hashes inside an encrypted manifest.

Each file and the manifest use AES-256-GCM with authenticated identity/path binding.
The random encryption key is wrapped with Windows CurrentUser DPAPI. File names
on disk are numeric; customer paths and document contents are encrypted. Output
permissions restrict access to the current Windows user. Keep the wrapped key
beside the encrypted files. Recovery currently requires this Windows account/PC;
this is not an independent off-device disaster-recovery copy.

The command compares inventories before and after downloading. If files change,
downloads fail, or validation fails, it does not finalize the manifest. Retain no
incomplete directory as a successful backup; retry into a new directory. Never
ignore an inventory mismatch to force completion. Verification decrypts every
object and checks its recorded size and hash; it prints counts only.

## Local recovery rehearsal

```powershell
node scripts/storage-recovery.cjs recover --dir backups/storage/NEW_BACKUP_ID --out backups/storage/NEW_RECOVERY_ID
```

All encrypted objects are authenticated before extraction starts. Recovery creates
a new private directory, recreates bucket/path structure, checks written bytes,
and writes `storage-manifest.json`. It never merges into an existing directory.
The recovered files and manifest are **plaintext customer data**: retain them only
for the protected rehearsal and remove them after recording the successful check.
Backup/recovery directories and environment files must remain Git-ignored.

For an actual hosted recovery, restore the matching database into an isolated
target first. Review bucket configuration and policies before uploading the exact
recovered paths. Logos are public-read; quotation PDFs remain private. Neither
bucket may have anonymous/authenticated browser write policies. Verify every
referenced asset, its checksum, tenant authorization and signed downloads before
switching application traffic. This tool does not claim that hosted recovery has
been rehearsed merely because local extraction passed.

## Consistency and scope

Take the database snapshot before storage. The application never overwrites or
deletes committed branding assets or issued PDFs, so later storage capture can
include all objects referenced by that snapshot plus newer objects. Do not delete
apparently unused objects automatically; historical revisions may reference them.
If external deletion or overwrite is possible, pause those operations throughout
both captures. The two captures are not a cross-service atomic snapshot. A quiet
storage inventory alone is not proof that every database reference exists: validate
references when rehearsing the matching database restore.

This companion covers the two named application buckets only, not Supabase Auth,
platform configuration, other buckets, database ownership/grants or Vercel secrets.
Those remain separate parts of the release/recovery procedure. Capture remains an
operator command; no automatic schedule or retention deletion is introduced.

Run `npm.cmd run test:storage-recovery` for encryption, pagination, nested paths,
corruption, concurrent-change rejection, privacy and local-recovery checks using
synthetic files. No hosted credentials or databases are used by that test suite.

## Verification - 2026-10-22

Twelve local tests passed, including paginated folder/file traversal, wrong-key
and corrupted/missing/swapped-file rejection, changed-source rejection, private
document bucket enforcement, exact plaintext reconstruction and Windows key unwrap.
Targeted lint and whitespace checks passed.

A fresh read-only production database backup was restored on an isolated Docker
network. All 108 tables and financial totals matched; three CHECK-expression
parenthesis differences were individually reviewed as equivalent. Both current
logo objects were backed up, decrypted and recovered with matching sizes/hashes.
Every storage reference in the matching database copy was resolved successfully.
There were no archived quotation PDFs in production at capture time; PDF recovery
coverage comes from synthetic tests, not a claimed production archive restore.

Encrypted artifacts/receipts are retained under Git-ignored backup directories.
Temporary plaintext asset files and the isolated database copy are removed after
verification. No production records, storage objects or configuration were changed.
Hosted upload/authorization recovery remains a separate release exercise.
