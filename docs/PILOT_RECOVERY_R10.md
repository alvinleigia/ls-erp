# R10 pilot recovery: phase 6B1

Verified on 2026-10-28. This checkpoint verifies a fresh application-schema backup
and isolated restoration of the actual pilot data. It does not certify the pending
upgrade, effective access after migration or a production release.

## Verified source

The explicitly checked production connection and Supabase API identify project
`tehtbbifiimoplzlewzs`. The database session was verified as the expected operator
and database, with transaction read-only enabled and complete backup visibility.
TLS certificate verification remained enabled. No environment values or client
records were printed.

The pilot has **108 applied migrations**, ending at
`20261024000100_flexible_team_intake`. Their checksums match a contiguous prefix of
the R10 source inventory, with no unresolved or duplicate attempts. There are
**24 pending migrations**, including the R9 profile/action/sharing changes and R10.
Do not substitute a presumed R9/111-migration baseline for this observed history.

## Fresh encrypted snapshot

Protected local backup: `backups/r10/b9dd5d7fd416/` (ignored by Git).

- A repeatable-read, read-only transaction exported the snapshot used by
  `pg_dump`. The archive retains application data, ownership and ACLs for
  `public` and `app`; it includes migration history.
- Source fingerprints cover **117 tables**, row identities/content by tenant,
  financial totals, columns, constraints, indexes, RLS, functions and sequences.
- The separate role archive excludes role passwords. The restored **31 role
  definitions and 25 memberships**, including grantor and grant-option details,
  match the source inventory; role settings also match.
- Database, role and source-evidence archives use authenticated AES-256-GCM
  encryption, with the key protected by Windows CurrentUser DPAPI. Plaintext
  database dumps were not written to disk.
- Both storage buckets were inventoried. **Two stored branding objects** decrypt
  and verify byte-for-byte. Both saved database asset references match their
  backed-up paths, lengths and hashes. The snapshot contains no staff-document
  rows and no foreign keys crossing the application-schema boundary.

This was an online snapshot for rehearsal. It is not a final cutover backup and
does not prevent later client writes. A release still needs a fresh backup at its
agreed cutover boundary.

## Restore and comparison

The restored database ran in disposable Docker PostgreSQL storage on an internal
network with **no published ports**. No application server, SMTP worker or client
login flow was started against it. Both the container and network were removed.

Restoration retained ownership and replayed the archive's schema/object/default
ACLs. No blanket grants or `--no-owner`/`--no-acl` restore were used.

Two PostgreSQL bootstrap details were verified explicitly:

1. The source bootstrap role at OID 10 is `supabase_admin`. Initializing the local
   cluster with that same identity preserves PostgreSQL's special membership
   grantor behavior. The role archive omits only its one duplicate CREATE ROLE;
   all role attributes, settings and membership statements still apply.
2. The empty initial `public` schema belongs to `pg_database_owner` and carries
   PostgreSQL's initial privileges. Preserve it and omit only the archive's exact
   duplicate CREATE SCHEMA entry. All schema ACL/comment/default-ACL entries still
   replay, and final ownership/grants are compared with the source. Dropping and
   recreating this schema had lost a source grant and correctly failed comparison.

Constraint definitions use PostgreSQL's canonical deparser. Complete constraint
rows are compared as a set in deterministic byte order because source and Alpine
collations order regclass text differently. ACL arrays are compared as complete
grant sets using PostgreSQL array parsing; grantors, privileges and grant options
remain significant. No constraint or permission difference is ignored.

All captured application data/schema/financial fingerprints and application
ownership/ACL fingerprints match after restore. Password-free role attributes,
memberships and settings also match. Earlier failed attempts have no success
receipt; `restore-receipt.json` records the completed verification.

## Evidence and remaining work

Private evidence consists of `backup.json`, `restore-receipt.json`, encrypted
database/role/source archives, protected keys and the encrypted storage backup.
The one-off recovery utility and its evidence helper are retained privately with
the backup for review. Neither is application code or a runtime migration adapter.

The backup is tied to this Windows account and PC, as previously requested. Its
scope is application recovery plus password-free role metadata, **not the complete
Supabase platform**, authentication credentials or managed services.

Six managed Supabase event triggers were inventoried and are not recreated in
this restored copy. Before certifying the upgrade rehearsal, review their actual
definitions/privilege dependencies and use a representative environment. Database
collation differences also remain an explicit environment consideration; a matching
data fingerprint does not prove every text-comparison behavior matches production.

Next, apply the **24 pending migrations to an isolated copy**, then compare pilot
IDs, saved content, financial evidence, owners, assignments, teams, profiles,
sharing and effective access against the observed 108-migration baseline. This
must cover the R9 permission translation as well as initial company/office
backfill; a row-count match alone is insufficient. Hosted staging acceptance and
a separately authorized production release remain after those checks.

No hosted migration, deployment, role change, storage write or saved browser
session change occurred in phase 6B1.
