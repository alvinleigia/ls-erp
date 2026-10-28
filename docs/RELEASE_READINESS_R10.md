# R10 release readiness: source and synthetic recovery

Phase 6A is local release preparation. It does not authorize deployment or certify
the pilot client's database. The R5 manifest, comparison rules and historical
cutover evidence remain unchanged.

## Source inventory

`release-source-r10.json` pins the current schema and all 132 migrations in Prisma
directory order. Its historical hashes match the reviewed R5 inventory, including
the twelve previously documented mixed-newline encodings. No historical SQL or
applied checksum was repaired or replaced.

Run `npm.cmd run release:r10:source` for a source receipt. It records Git HEAD,
worktree cleanliness and the manifest digest. Commit the reviewed changes before
using that receipt to identify a release candidate. An edited, added, missing or
reordered migration, or a changed schema, fails verification. Future source changes
require explicit review and an inventory update; there is no automatic updater.

`historyProblems` checks actual history against that inventory. A pre-upgrade
baseline must be a contiguous prefix with matching checksums and no unresolved or
duplicate attempts. Rolled-back attempts never count as applied. The tool does not
guess the hosted baseline from an earlier document or from migration count alone.
A source receipt always leaves hosted history, pilot recovery and acceptance
unverified, with release approval false.

## Isolated recovery test

Run on Windows with Docker available:

```powershell
npm.cmd run test:release-r10
npm.cmd run test:release-r10:recovery
```

The first command checks source/history failures, storage backup integrity and
Windows recovery-key protection. The second owns two disposable local PostgreSQL
containers and uses synthetic data only:

1. Rehearse historical upgrades, preservation and forced rollbacks with all three
   historical office/booking/daily compatibility fixtures disabled.
2. Take a full custom-format `pg_dump` and role archive. Encrypt both using
   AES-256-GCM and protect the random key with Windows CurrentUser DPAPI. Persist
   encrypted files in a private directory; plaintext dumps stay in memory.
3. Read and decrypt the persisted files; reject altered ciphertext and a wrong
   archive label.
4. Run actual `prisma migrate deploy` on an empty database in a fresh cluster.
   Check all 132 history entries, enum/function definitions, table definitions,
   constraints, indexes and RLS against the historical rehearsal result. This
   also verifies the real ordering of the two `20261027000100` migrations.
5. Restore synthetic roles and the complete archive into another empty database
   in that fresh cluster, retaining ownership and ACLs. Only the exact Docker
   bootstrap `CREATE ROLE postgres` is removed; its attributes and all other
   role/grant statements remain. This is not a Supabase role-exclusion recipe.
6. Compare row identities/content, tenant partitions, financial totals, migration
   history, foreign keys and schema/RLS fingerprints. Separately compare role
   attributes/memberships/settings, schema/relation/function owners and ACLs,
   default ACLs, function security settings, triggers and sequence state.
7. Run the existing native office-record, external-login and inventory access
   integration suites against the restored database using the ordinary runtime
   role. Remove both owned containers, including on failure.

Recovery snapshots use format 3: constraint definitions come from PostgreSQL's
canonical `pg_get_constraintdef(oid, true)` deparser. Dump/restore flattens redundant
nested AND parentheses in three existing CHECK expressions; canonical output
preserves their meaning and operator precedence without string substitutions or
per-constraint exceptions. Row hashes, constraint names/types/validation and every
other fingerprint remain strict. Historical R5 snapshots still use format 2 and
the unchanged R5 comparison rules.

Function ACL comparison expands PostgreSQL's default-ACL shorthand and sorts
explicit grant tuples. Grantor, grantee, privilege and grant option remain part
of the fingerprint. A restored-database test checks public revocation, restoration,
an added direct grant and a changed grant option; no grant is ignored.

Evidence remains under ignored `tmp/industry-release/ls-erp-r10-recovery-*` in a
directory restricted to the current Windows user. Only a completed receipt counts
as success. The key requires that Windows account on this PC; this local synthetic
archive is neither an independent disaster-recovery copy nor a client backup.
Storage tests use synthetic bucket objects, not hosted client branding/documents.

## Verified locally on 2026-10-28

- **17 source/history/storage checks passed**, including actual Windows key
  protection, corruption rejection and byte-exact synthetic object recovery.
- Historical preservation/rollback rehearsals reached **132 migrations**, with
  all **18 native stock preservation checks** passing and all three compatibility
  fixtures disabled.
- Actual Prisma deployment of **132 migrations** matched the rehearsal schema,
  constraints, indexes, enums, functions and RLS.
- The persisted encrypted database and role archives restored into a fresh
  cluster. Fingerprints matched for **132 business tables**, financial totals,
  migration history and the security catalog described above.
- **45 restored-database checks passed with zero skips**: 25 office-record,
  10 external-login, 7 inventory and 3 recovery-format/ACL cases.
- Changed tooling passed ESLint and whitespace checks. There are no runtime UI
  changes in this phase; phase 5's build/Chrome evidence remains separate.

Ignored evidence: `tmp/industry-release/phase6-unit.log`,
`phase6-recovery.log` and `ls-erp-r10-recovery-33a19e51ab04/receipt.json`, with its
encrypted archives, Prisma deployment log and restored-access log. Failed earlier
attempts have no completed receipt and must not be used as success evidence.
Both owned containers were removed. No hosted data, deployment or saved browser
session changed.

## Remaining hosted gates

Phase 6B1 now verifies the [actual pilot backup and application restore](PILOT_RECOVERY_R10.md):
107 applied migrations (108 history attempts), 117 tables and both stored assets.
[Phase 6B2](PILOT_UPGRADE_R10.md) then rehearsed all 25 pending migrations,
compared existing account readable-record access and verified policy translation.
Phase 6C now verifies the [staging migration, deployment and initial hosted checks](STAGING_RELEASE_R10.md).
Phase 6D1 also verifies [hosted team/office boundaries and partner logins](STAGING_BOUNDARIES_R10.md).
Phase 6D2 verifies [hosted financial transitions, linked privacy and reporting](STAGING_FINANCIAL_R10.md).
Phase 6D3 verifies [hosted appointments, purchase receipts and office stock](STAGING_OPERATIONS_R10.md).
Phase 6D4 verifies [hosted Leaves/Shifts, approval routing and roster boundaries](STAGING_WORKFORCE_R10.md).
Phase 6D5 verifies [multiple managers, invitations and module activation](STAGING_GOVERNANCE_R10.md), with natural expiry covered by fresh disposable-local tests.
Phase 6D6 verifies [hosted browser edits, Restricted sharing and linked source boundaries](STAGING_SHARING_R10.md).
Wider hosted acceptance and the documented managed-environment differences remain.

| Gate | Local evidence | Still required before release |
| --- | --- | --- |
| Candidate source | Pinned schema/migration inventory; exact candidate `525b853` verified READY on all three staging aliases | Recheck the selected production candidate at release time |
| Upgrade semantics | Synthetic preservation, empty-database Prisma deploy and actual pilot-copy upgrade from 107 to 132 | Recheck the live target at release time; retain the original rolled-back attempt and never rewrite history to silence a discrepancy |
| Recovery | Encrypted synthetic recovery plus fresh pilot application/role/storage backup and isolated restore | Review managed dependencies/environment fidelity, then repeat fresh recovery verification at the release boundary; this does not certify complete Supabase platform recovery |
| Existing access | Native synthetic and pilot-copy evidence; hosted team/office/profile, financial, stock, workforce and activation checks; phase 6D6 sharing/action/None bounds, source-private CSV/financial reads and immediate grant revocation | Review the combined evidence and documented limits for the selected release; pilot-copy evidence does not exercise business writes |
| UI and hosted behavior | Local Chrome and hosted captures through phase 6D6; actual mobile enquiry/project edits, Sharing controls, read-only financial views, 188 sharing checks and 89 cleanup-audit checks; phase 6D5 invitations/activation and 76 local onboarding/account tests | No exhaustive form/browser matrix or directly observed seven-day hosted expiry is claimed; rerun affected flows if the candidate changes; refresh Vercel metadata after HTTP 403 |
| Production | No changes made | Separately authorized release and agreed maintenance/recovery window |

Do not use the older R5-only source verifier to approve R10. Its strict historical
inventory is intentionally different. Never infer pilot restoration or permission
preservation from a successful empty-database deployment or synthetic test alone.
