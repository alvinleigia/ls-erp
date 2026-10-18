# R5 cutover procedure

Prepared and locally rehearsed 2026-10-18. **Not executed on production.**
This is a platform-wide maintenance operation: blocking the shared runtime role
affects every tenant, including authentication and reads. It is not tenant
suspension and does not alter tenant/user statuses or business permissions.

## Verified target and artifacts

- Vercel team/project: `leiwissen/ls-erp`, project
  `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`; domain `erp.ewissen.in`.
- Previous verified production deployment: `dpl_FjvreJBMLNBi4gNJtywYeNcngpzd`,
  baseline `5f1323807141f3785e1a8bd45b39e54cbc727c53`. Recheck at execution time.
- Supabase project: `tehtbbifiimoplzlewzs`. Runtime role `prisma_app`; operator
  `postgres`. Use the verified private `.env.new-vercel`, not the older `.env`.
- The stale local `.vercel` link must not select the target implicitly.
- Application fingerprint: `tmp/industry-release/r5-application-source.json`.
  Verify every present/deleted path, then record the exact approved release commit.
- Migration contract: `docs/industry-release-manifest.json`: 97 baseline entries
  and two additive release migrations. Never edit applied migration history.
- Protected rehearsal backup and recovery instructions:
  `backups/r5/9d534e25f642/`. This is an earlier snapshot, not the cutover backup.
  It remains tied to this Windows account and PC, as the user requested.

## Preconditions before scheduling execution

1. Finish release review and retain the existing Vercel environment settings.
   The local environment file is incomplete; do not bulk replace Vercel values.
   Keep previous deployment and its configuration available for recovery.
2. Agree a maintenance window with the user. Notify tenant operators through
   their normal channel; this document does not authorize sending messages.
3. Re-inventory all writers: web/API deployments, imports, reminder jobs, external
   integrations, SQL-editor sessions and other tools using privileged credentials.
   Pause them and allow work to finish. A runtime-role freeze cannot stop an
   administrator, a different database role or external side effects.
4. Confirm any assets/storage added since rehearsal and include them in recovery.
5. Use the ownership/ACL-preserving restore procedure rehearsed below. At execution
   time re-inventory owners, schema/object/default ACLs, operator privileges and
   external dependencies; compare against the fresh backup. The operator cannot
   SET ROLE to supabase_admin, so managed default ACLs must remain in place.
   Unknown owners, changed privileges or new external dependencies stop recovery
   until reviewed. Do not use blanket GRANT ALL, schema CASCADE or omit object ACLs.

## Freeze and drain

The following SQL is an operator procedure, not an application migration. It must
only run against the verified target during the agreed window. Capture a protected
receipt of runtime role OID, login flag and connection limit immediately beforehand.
The current observed values are LOGIN and connection limit -1; do not assume they
remain unchanged at cutover. Confirm the operator has ADMIN on this role and can
signal its backends. The source operator is non-superuser and cannot SET ROLE to
`prisma_app`; no extra membership should be granted merely to bypass this limit.

```sql
SELECT oid, rolname, rolcanlogin, rolconnlimit, rolsuper, rolbypassrls
FROM pg_roles WHERE rolname = 'prisma_app';

ALTER ROLE prisma_app NOLOGIN CONNECTION LIMIT 0;

SELECT pid, pg_terminate_backend(pid, 5000) AS stopped
FROM pg_stat_activity
WHERE usename = 'prisma_app' AND pid <> pg_backend_pid();

SELECT count(*) AS remaining_runtime_backends
FROM pg_stat_activity WHERE usename = 'prisma_app';

SELECT count(*) AS prepared_transactions
FROM pg_prepared_xacts WHERE database = current_database();
```

NOLOGIN does not close existing sessions. Termination rolls back unfinished
transactions; let work drain normally first to avoid interrupting a user's save.
The freeze is established only when runtime backends and prepared transactions
are zero, known privileged writers are stopped, and a fresh connection through
the **actual transaction-pooler DATABASE_URL** fails. Check the session identity
before freeze: a pooler using another login role requires a different reviewed
procedure. Do not assume local direct-Postgres testing proves Supavisor behavior.
If a probe still connects, stop: do not take the final snapshot or apply migrations.

Do not use `default_transaction_read_only` as the sole barrier: it is a session
default, not an irrevocable write restriction. Do not rely on logging users out,
hidden buttons or a browser notice to stop writes. During this hard freeze the
application may show connection errors; no maintenance-page feature was added.

## Final backup, migration and verification

1. With the freeze verified, capture a fresh consistent encrypted backup and asset
   inventory using the verified operator connection. Retain checksums, the matching
   deployment/environment identity and before fingerprints. Restore this **fresh**
   archive in isolation and verify it; the older rehearsal archive is insufficient.
2. Recheck the 97 applied migration entries and reviewed byte encodings. Confirm
   the two planned migrations are the only pending ones. Unknown state stops work.
3. Point the migration command explicitly at the verified operator connection and
   deploy the two reviewed migrations. Never give the build runtime owner credentials.
4. Compare all existing per-tenant row/content/identity fingerprints, financial totals,
   schema/RLS/foreign keys and history against the fresh before capture. Only the
   manifest's index change and two empty terminology tables are permitted. Confirm
   new-table runtime privileges inherited the expected defaults.
5. Deploy the approved application revision to the explicit Vercel project with
   its existing settings. Keep the runtime role blocked while verifying deployment
   revision/status, assets, login-page rendering and database reconciliation.
   An authenticated production API check cannot pass while its login is disabled;
   do not describe a static page check as an authenticated workflow test.

## Reopening and immediate checks

After the preceding checks pass, restore the **captured** login flag and connection
limit. For the currently observed values the command would be:

```sql
ALTER ROLE prisma_app LOGIN CONNECTION LIMIT -1;
```

Recheck a fresh pooler connection, tenant login, module visibility, scoped record
lists and existing quotation/document reads. Verify the production alias points
to the approved deployment, then resume paused jobs/integrations. Ask users to
reload stale tabs. Record the reopening time: once any writer can commit again,
recovery must preserve those newer writes. If a problem appears after reopening,
freeze/drain again and select a forward fix or reconciled recovery; never restore
the earlier snapshot over new customer activity.

## Failure paths

- Before migrations: retain diagnostics, restore captured role attributes and
  verify reconnection. No data restore is needed merely to undo the connection freeze.
- After migration, before reopening: keep the role blocked, inspect the failure and
  use the reviewed recovery procedure with the **fresh cutover backup** and matching
  previous application/configuration. Do not mark a failed migration applied or
  silently remove migration-history rows. A complete database restore legitimately
  restores the history contained in that backup.
- In-place recovery must account for release-created objects not present in the
  old archive. Our local test removed only the two named new terminology tables,
  after asserting both empty, before clean restore. Unknown objects or nonempty new
  tables stop this route. Do not generalize this to dropping arbitrary new tables.
- On any restore failure: remain frozen. Do not automatically reopen from a finally
  block. Reopen only after matching data, schema, access grants and application state
  have been verified. Keep the operator connection available to reverse the freeze.

## Rehearsal evidence

`node scripts/test-historical-upgrade.cjs --cutover` creates its own internal
Docker network, replays the release schema and runs seven assertions/subtests.
It accepts no hosted database, uses synthetic roles/records, and cleans up its
container/network. Tests reproduce a non-superuser operator with ADMIN but no
SET ROLE access, prove new-login rejection, existing-writer termination and
transaction rollback, allow operator DDL/read reconciliation while blocked,
restore the prior connection limit/grants and test abort-before-migration recovery.

Seven passed, no skips: `ls-erp-history-0875b9bbb713.log`.
Read-only source authority inventory: `r5-cutover-authority-1792317704970.json`.
Both are in protected `tmp/industry-release/`.

The client-copy rehearsal restored the protected archive, deployed 97 -> 99
migrations, then restored the backup over the upgraded copy. All 104 source table
fingerprints (including migration history), financial totals, schema and RLS
matched; zero foreign-key orphans. Two previously reviewed CHECK-expression
reparses were the only accepted formatting differences. Evidence:
`9d534e25f642-upgrade-1792317879062-result.json` and
`9d534e25f642-rollback-1792317974707-restore-result.json`.

That initial local recovery omitted source ownership/ACL application. The later
rehearsal below closes that application recovery-permission gap.

## Ownership and permission preserving recovery

Source inventory confirmed the database owner is postgres; application objects
are owned by postgres, with the built-in public schema owned by pg_database_owner.
The operator is non-superuser, with BYPASSRLS/CREATEROLE/CREATEDB, and cannot SET
ROLE to supabase_admin. Three archive default-ACL entries belong to supabase_admin.
Replaying them as postgres would be inappropriate; dropping/recreating public
can also lose its implicit PUBLIC USAGE privilege.

The tested recovery preserves both existing schemas and their permissions,
including **all** default ACLs. From the **fresh archive's own** pg_restore list,
exclude only these entries, after verifying their identity:

- SCHEMA definitions for app and public (two entries).
- Their SCHEMA ACL entries (two) and public SCHEMA comment (one).
- DEFAULT ACL entries in app/public (seven in the verified archive).

Retain all table/function/object ownership and ACL entries. The 12 exclusions
preserve existing schema-level state; they do not omit application object grants.
Do not reuse TOC IDs from the old snapshot, remove arbitrary restore errors from
the list, or apply `--no-owner`/`--no-acl`. A changed inventory requires review.

After the verified freeze and the empty-new-table checks above, the restore mode is
`pg_restore --clean --if-exists --use-list=<reviewed-list> --exit-on-error
--single-transaction`, using the verified operator connection and decrypted archive
streamed in memory. Keep all writers blocked throughout. The existing schemas,
schema ACLs and defaults must equal the pre-cutover capture before and after;
table/function owners and ACLs must equal the backup's verified baseline as well.

Rehearsal created a separate isolated cluster with source ownership, schema ACLs,
104 table ACLs, 22 function ACLs, seven default ACLs and six source event-trigger
functions. A separate local bootstrap account established the fixture; **migration
and recovery ran as non-superuser postgres**, matching the source operator. Both
release migrations applied, then selective clean restore recovered the baseline.

Ownership/ACLs match the source catalog (ACL entry order normalized only). All
data/schema/history fingerprints match the pre-upgrade capture: 103 business tables
plus migration history, 97 baseline migration entries and zero FK orphans. Schema
and default ACLs, event-trigger function hashes and owner state are unchanged.
No temporary production grants or managed-role impersonation are required.

Evidence under protected tmp/industry-release/:
`r5-recovery-permissions-1792318395690.json` and
`9d534e25f642-acl-1792318584857-{before-permissions,after-permissions,before-data,after-data,result}.json`.
The exact reviewed list is `9d534e25f642-acl-1792318584857-restore.list`.

This exercises the relevant source event-trigger functions in an isolated cluster;
it does not recreate every managed Supabase extension/service. Source metadata
showed no external-schema foreign keys into application tables. Re-inventory
dependencies and permissions for the final snapshot rather than treating this
earlier result as permanent production equivalence. All local containers/networks
were removed. No hosted role, session, data, environment or deployment was changed.
