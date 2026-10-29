# Participant and document release - P6A pilot rehearsal

Follow-up: [P6B hosted staging release](PARTICIPANTS_STAGING_RELEASE.md) is complete.
This document retains the original P6A checkpoint and its observed targets.

Completed locally on 2026-10-29 (Asia/Kolkata). This checkpoint verifies a fresh
protected pilot copy, the four pending migrations and preserved access. It does
not deploy P1-P5, approve production maintenance or complete hosted acceptance.

## Observed source and pinned candidate

Read-only Vercel checks confirmed production `ls-erp` is READY at
`f9e24db1812e069845d248b345b50b48fcd2e32e`, deployment
`dpl_5an58aZq3r8VUYi785v6WV7ddYK1`. Staging remains READY at
`525b8539b968a6858b403e28a48d9de494c5e8b4`, deployment
`dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`. These are the earlier R10 releases.
Neither hosted target received the participant/document changes in this phase.

`docs/release-source-participants.json` pins the candidate schema and all 136
migration checksums. Its first 132 entries retain the released R10 inventory
exactly, including the reviewed historical newline encodings. The R10 manifest
is unchanged. The next four migrations add participants, customer-information
configuration/acceptance, order references/dates and immutable document issuance.

`scripts/participant-release-readiness.cjs` reuses the source/history validator
with an explicit release identity. It validates a contiguous observed baseline;
it never repairs migration history, infers release approval or connects to a DB.
The R10 validator retains its strict default release identity.

## Fresh protected backup and restoration

The source was explicitly checked as Supabase project `tehtbbifiimoplzlewzs`.
The operator connection verified the project-specific session-pooler username,
database, complete backup visibility, read-only transaction mode and TLS server
certificate. The same project was checked for Storage. No environment values,
client names, contact details, credentials or stored object paths were printed.

Protected recovery set: `backups/participants/fdf75d392954/`, ignored by Git.

- The repeatable-read, read-only transaction exported the snapshot consumed by
  `pg_dump`. Application schemas `public` and `app`, ownership/ACLs, original
  migration attempts and password-free database role metadata were retained.
- Database, role, source-evidence and managed-environment archives use
  authenticated AES-256-GCM. The random key uses Windows CurrentUser DPAPI.
  Plaintext database archives were streamed in memory rather than written to disk.
- All two stored branding files decrypt and match their recorded bytes/hashes.
  Both saved database asset references match the encrypted Storage companion.
  The backup enumerates all objects in both application buckets, including
  historical/unreferenced files, rather than collecting only current assets.
- Restoration retained original application data, constraints, RLS, owners,
  ACLs, global role attributes, memberships and settings. Existing bootstrap
  role/schema handling follows the verified R10 restore procedure; no blanket
  grants, `--no-owner` or `--no-acl` workaround was used.

The restored database ran on an internal Docker network, with no published ports
and temporary database storage. The application, SMTP and other business workers
were not started against copied client records. Only read-only code mounts were
supplied. The owned database container and internal network were removed after
each attempt. The first attempt stopped on a missing dependency mount point;
after fixing that setup, the full rehearsal passed. That failed attempt is not
completion evidence and did not change a hosted target.

This is application/role/storage recovery under the previously requested local
Windows-account protection, not a complete Supabase or off-device recovery copy.
It is an online rehearsal snapshot, not a final cutover snapshot. Client writes
after capture require a fresh backup for an eventual production release.

## Native upgrade and preservation

Actual `prisma migrate deploy`, using a source-equivalent non-superuser operator
with BYPASSRLS, applied all four migrations inside the restored copy.

| Check | Result |
| --- | --- |
| Before | 132 applied migrations; 133 attempts; one original rollback; four pending |
| After | 136 applied migrations; 137 attempts; the same rollback; zero pending |
| Existing application tables | All original columns/values in all 132 tables match |
| Original migration attempts | Every original ID, timestamp, checksum and content retained |
| New tables | Five empty tables; no inferred participants, templates or sequence rows |
| Profiles, assignments and action rules | Exact original persisted values |
| Teams, offices, memberships and sharing | Exact original persisted values |
| Module flags, snapshots and financial rows | Exact original persisted values |
| Original table owners/ACLs and global roles | Preserved |
| Existing saved asset references | Both unchanged |

Existing opportunities retain null, unrecorded correspondence. Existing order
acceptance/reference/date fields are not manufactured. No missing customer IDs,
historical property evidence or document wording is backfilled. The pilot has
zero saved quotations/orders needing a historical participant/reference correction
in this snapshot. A different tenant's populated historical records would need
their own evidence review; this result is not an authorization to infer values.

## Effective access comparison

The before probes load the actual deployed production source revision; the after
probes load the candidate source. Both use the ordinary `prisma_app` role, which
is neither superuser nor BYPASSRLS, with transaction-local tenant/actor binding
and read-only sessions. No application compatibility mode or alternate runtime
policy was introduced.

All **seven existing accounts** matched over **161 resource/action checks** and
**1,235 account/record/action bindings**. Existing effective profile permission
sets also match. The checks cover the existing CRM, activity, project, quotation
and sales-root Read/Edit/Export predicates where those actions exist. Financial
and reservation resources use their sales-order-root bounds in this comparison.
Denied entrypoints remain denied, and deliberate foreign-tenant enquiry/order
queries return no records even without the application's record predicate.

These are policy-population probes, not execution of every possible business edit,
financial transition, report or UI flow on pilot records. The populated synthetic
document/booking/payment and native security cases retain P5's separate evidence.
New Order documents and Company document templates permissions are not added to
existing saved profiles. Their deliberate enablement remains an administration
decision; new actions cannot silently expand a client's old permissions.

## Environment and recovery coverage

The source and local PostgreSQL major/minor versions are 17.11. ICU provider,
`en-US` locale and collation/ctype match. The six actual managed DDL event-trigger
definitions, owners, tags and enabled states were reproduced exactly and remained
unchanged after migration. No pending migration performs extension DDL.

The source ICU collation version is 153.121 and the local version is 153.128.
Full Supabase services and extension workloads are not reproduced. The result
therefore certifies the tested data, access and native migration behavior;
hosted sorting/search behavior and application workflows still need staging.

`scripts/document-recovery.cjs` now explicitly inventories every immutable issued
order version and its frozen logo, alongside existing settings, appointment and
quotation assets. Reference checks reject missing files, byte/hash mismatches,
foreign-tenant paths and public document buckets. The reviewed pre-P5 schema may
lack the new table; malformed references in an existing table are never ignored.

All **19 release/storage checks passed** without skips, including separate exact
recovery of an original order PDF and its replacement, ciphertext corruption,
wrong keys, missing/swapped files, paginated storage and stale/mismatched backups.
Changed-tooling ESLint, source inventory and Git whitespace checks passed.
Application code did not change, so the verified P5 build/browser results remain
the application baseline for the next staging step.

## Evidence and remaining gates

The protected backup folder contains `backup.json`, encrypted archives and
`upgrade-1793213877240-receipt.json`. The latter pins the production source,
history summaries, preservation/access results, environment differences and
one-off tool hashes. `tmp/participants/p6-evidence/receipt.json` binds the tracked
tooling checks and local commit; no client rows or credentials are committed.

Repeat the source/history/storage checks with `npm.cmd run test:participant-release`
and `npm.cmd run release:participants:source`. These commands do not back up, migrate,
deploy or approve anything. The actual copied-data utilities stay private and
separate from the application; they are not automatic migration adapters.

P6 continues in two release gates:

1. **P6B - hosted staging:** back up the distinct staging project, apply the four
   migrations there, deploy the reviewed candidate and test with isolated
   synthetic tenants through normal application APIs/browser flows. Do not copy
   pilot records into a hosted test tenant or run local fixture/seed/reset code
   against the hosted database. Verify original staging grants/data separately.
2. **P6C - production:** a separately approved maintenance window, fresh verified
   recovery artifacts, migration/deployment reconciliation and access checks
   before reopening. Production has not been frozen, migrated, pushed or deployed
   by this checkpoint.
