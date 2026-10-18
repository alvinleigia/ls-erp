# Industry-neutral release package

R4 local preparation, 2026-10-18. **Not a production approval or client-data
reconciliation result.** R5 must inventory the actual deployment, protect and
restore its backup, and rehearse this package before cutover. Nothing here
establishes that the hosted application currently matches the source baseline.

## Reviewed migration contract

Source baseline: `5f13238`. [Machine-readable manifest](industry-release-manifest.json)
contains 97 unchanged baseline migrations, two release migrations, the current
Prisma schema checksum, 103 required baseline tables and the allowed new schemas.
Historical SQL was compared with that Git commit. Both LF and CRLF checksums are
recorded. R5 also proved twelve original files use LF with a final CRLF; their
exact hashes are pinned as `sha256LfFinalCrlf` and verified by reconstructing
that encoding from unchanged SQL. A substantive SQL change requires a new review,
not a checksum override. See [R5 evidence](INDUSTRY_NEUTRAL_R5.md).

| Order | Migration | Expected change | Existing records |
| --- | --- | --- | --- |
| 1 | `20261016170000_tenant_default_shift_schedule` | Replace the global default-shift unique index with a partial unique index on tenantId | No rewrite; duplicate defaults within one tenant cause failure, not automatic repair |
| 2 | `20261017120000_tenant_terminology` | Add empty terminology and revision tables, constraints and forced tenant RLS | No seeding or rewrite; code-owned defaults remain effective |

Both migrations are transactional. The terminology migration's transaction
wrapper was added while it was still local and unreleased. A conflict test proves
its first table is rolled back when creating the second fails. Do not edit any
already-applied migration to match this package. If inventory finds these release
migrations already applied, different checksums, missing baseline migrations or
unexpected schema, stop and reconcile the release history first.

No table renaming, duplicate runtime, compatibility service, client-data backfill,
default-preset application or automatic data correction is part of this release.
Configuration, access-role grants, memberships, custom-field identities and
required cohorts, project links, quotations, saved snapshots, import rows and
audit history must retain their stored values.

## Local checks

Run from the repository root:

```powershell
node scripts/industry-release.cjs verify
```

This reads source files only. It rejects a changed migration inventory, changed
SQL or changed Prisma schema. The manifest pins schema and migrations; R5 must
also pin the complete application revision and environment configuration before
deploying. Do not automatically regenerate the manifest to bypass a failed check.

To exercise all four historical upgrade fixtures with the existing CRM/property
integration suites, run `node scripts/test-historical-upgrade.cjs`. Requires
Docker, installed dependencies/generated Prisma client, and locally installed
`postgres:17-alpine` and `node:24-alpine` images. The runner verifies the manifest,
replays all 99 migrations with synthetic records inserted before their upgrades,
and requires zero skipped tests. It creates/removes its own internal network and
database container, with no host ports, environment files or client data. Evidence
is written under ignored `tmp/industry-release/`. This does not replace client
backup reconciliation or Prisma deployment rehearsal.

The reconciliation tool does not load `.env` and never applies migrations. Set
`RECONCILE_DATABASE_URL` privately to the restored **local** rehearsal database.
Only localhost/127.0.0.1 and `ls_erp_rehearsal` (or isolated test database names)
are accepted. URL connection parameters are rejected. Hosted databases are not
accepted by this tool.

```powershell
node scripts/industry-release.cjs capture before.json
# R5: apply the reviewed migrations to the isolated restored copy, then:
node scripts/industry-release.cjs capture after.json
node scripts/industry-release.cjs compare before.json after.json
```

Files are saved only under ignored `tmp/industry-release/`; existing files cannot
be overwritten. Use new filenames for subsequent rehearsals. Protect this folder
with local OS access controls: reports include tenant identifiers and aggregate
amounts even though they contain no raw customer rows or credentials. File mode
0600 is requested where supported; this does not replace Windows ACLs or encrypted
backup storage. Do not commit or attach these reports to public issues.

Capture uses a single read-only, repeatable-read transaction, fixed timezone and
search path, bounded 500-row cursor fetches, and query/lock timeouts. It requires
a local backup-reader role with complete RLS visibility so an empty restricted
result cannot masquerade as a complete backup. Application permission tests must
separately use the normal non-bypass runtime role.

R5 updated capture output to **format 2**. Tables without a primary key (including
authentication verification tokens) use a valid, immediate, non-partial unique
index whose key columns are all non-null. Nullable, expression, partial and
deferred uniqueness are rejected. Identity JSON is ordered with the `C`
collation, so differing database text-sort locales do not change fingerprints.
Regenerate both snapshots when moving from format 1; mixed/old formats fail.

Comparison fails on:

- Missing/unknown/unfinished/duplicate migration history or checksum mismatch.
- Missing baseline tables or unexpected additions, column/constraint/index/RLS
  policy changes; only the two reviewed schema changes are allowed.
- Invalid indexes or unvalidated constraints during capture, foreign-key orphans,
  enum changes or altered functions in the isolation `app` schema.
- Per-table/per-tenant row count, unique row-identity fingerprint or full-content
  fingerprint changes. Whole stored rows include versions, timestamps, monetary
  values and quotation revision snapshots; counts alone are not accepted.
- Changed stored opportunity and quotation totals grouped by tenant and currency.
  These are reconciliation totals, not revenue or collected-payment KPIs.
- Nonempty newly added terminology tables or differences from their expected
  constraints, indexes and forced RLS policies.

The tool streams rows and stores aggregate SHA-256 fingerprints; decimal and JSON
values remain PostgreSQL text and are not rounded through JavaScript numbers.
It scans data on an offline copy and is not an application request-time query.
Concurrent business activity between captures causes a legitimate mismatch;
freeze all writers and background work in the rehearsal environment.

## R5 execution and stop conditions

The concrete [cutover procedure](INDUSTRY_NEUTRAL_CUTOVER.md) records the runtime
role freeze/drain, recovery and reopening sequence. Its isolated freeze rehearsal
runs with `node scripts/test-historical-upgrade.cjs --cutover`. Production execution
still requires the documented recovery-permission checks and agreed window.

1. Verify the real Vercel project/deployment, database, tenants, migration history,
   integrations, assets and in-flight imports/jobs. Do not infer the target from
   old local environment files or Vercel links. Compare actual history with this
   contract before selecting a release sequence. Compare the restored schema with
   the baseline schema/migrations too: unchanged pre-existing drift can pass a
   before/after comparison and is not certified by table names or migration history.
2. Take a protected consistent database backup and required object/file-storage
   backup. Record checksums, access controls, retention and the matching previous
   application/environment. Prove restoration to the isolated local database.
3. Suppress email, reminders, workers and integration calls in the copy. Capture
   before evidence. Point **both** runtime and migration connection variables at
   that verified copy before running Prisma migration deployment. Capture after
   evidence and compare. Never resolve a failed migration as applied merely to
   make the comparison green.
4. Run full release/build, RLS/access, module-on/off and business workflow tests
   with a non-bypass runtime role. Measure baseline/final query counts and plans
   on representative restored data. Re-run previously deferred historical upgrade
   fixtures; they are not covered by the checker fixture below.
5. Check items outside this tool: asset availability/content hashes, storage
   policies, database role grants, sequences, extensions, external integrations,
   domain/auth settings and operational recovery. A table fingerprint is not a
   substitute for these checks or for runtime isolation tests.
6. Agree the production maintenance window, enforce server-side write suspension
   (including jobs/imports/integrations), drain work and take a final consistent
   recovery backup. Deploy only the exact rehearsed code/migrations. Require fresh
   clients where contracts changed. Verify before reopening writes.
7. If verification fails before reopening, restore database/assets and the matching
   previous application together. After reopening, stop writes and plan a forward
   fix or reconciled recovery; never overwrite new client activity with an old backup.

Any failed comparison, unverified restore, missing artifact, unresolved access
failure or unconfirmed target blocks cutover. The tool reports differences only;
it does not delete, repair, import, reset, seed, deploy or roll back anything.

## Local evidence and limitations

`tests/industry-release.test.cjs` and
`tests/industry-release.integration.test.cjs`: five tests passed, no skips.
The integration fixture uses representative tables, synthetic migration-history
rows and 1,201 records across two tenants; it applies the actual two release SQL
files. It verifies cursor batching, precision-sensitive mutation detection,
orphan detection, failure rollback, unchanged repeated captures, and rejection of
an RLS-restricted reader. Unit cases exercise record replacement, tenant moves,
snapshot changes, schema/security drift and bad migration history.

The representative fixture deliberately fails the full 103-table manifest's
baseline gate. Its limited comparison tests checker mechanics, **not** Ewissen's
upgrade, complete historical migration chain, restore completeness, runtime RLS or
production performance. Those remain explicit R5 requirements.

Evidence logs: `tmp/r4b5-checks-final.log`, `tmp/r4b5-lint.log` and
`tmp/r4b5-whitespace.log`. Source-only manifest verification passed. No hosted
database was queried, no client records were changed, and nothing was committed,
pushed or deployed. No application runtime/UI changed in this batch, so the R4
batch 4 build/browser results were not rerun as release-package evidence.
