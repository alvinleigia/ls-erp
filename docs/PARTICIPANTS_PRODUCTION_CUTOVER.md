# Participant/document production cutover - P6C

Execution completed under explicit user approval. See
[the production release record](PARTICIPANTS_PRODUCTION_RELEASE.md).
This runbook retains the original preflight checkpoint and cutover procedure.

Prepared on 2026-10-29 (Asia/Kolkata). Read-only production preflight and a fresh
isolated pilot-copy upgrade passed. Production remains open on R10. No live
freeze, migration, branch push or deployment has been performed by this checkpoint.

The remaining execution requires the separately agreed maintenance window from
[the P6B release gate](PARTICIPANTS_STAGING_RELEASE.md). It briefly interrupts
login, reads and writes for all tenants using the shared production runtime role.

## Exact release boundary

- Production: `ls-erp`, project `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`, team
  `team_Me0kX6NgE1RN4MNKRXXCfrsZ`, Git production branch `main`.
- Current deployment: `dpl_5an58aZq3r8VUYi785v6WV7ddYK1`, READY at
  `f9e24db1812e069845d248b345b50b48fcd2e32e`.
- Verified production domains: `erp.ewissen.in`, `leiwissen.leigia.com`,
  `ls-erp-phi.vercel.app`. All must resolve to the verified release before reopening.
- Production Supabase: `tehtbbifiimoplzlewzs`; operator/runtime credentials come
  from the protected `.env.new-vercel`, with strict project/role/port/TLS checks.
- Tested application: `ae3e49115da1ef0cef472684a0a675b26f42a4b7`, currently READY
  on staging as `dpl_6z6K6LfBXVJvZ4PxsC4PteUyfVic`. The proposed release commit
  adds documentation only to this tested source. The pinned candidate in private
  release evidence must match its non-documentation files exactly.
- Four reviewed migrations: `20261028000100_opportunity_participants`,
  `20261028000200_participant_information`, `20261028000300_sales_order_references`,
  `20261028000400_order_document_issuance`. The participant source manifest retains
  all first 132 released checksums exactly.
- Expected history: 132 applied / 133 attempts / four pending / one original
  rollback becomes 136 applied / 137 attempts / zero pending / that same rollback.

Local `main` and remote GitHub `main` remain at the current production commit.
A dry-run fast-forward push passed. Staging's Git-triggered deployments are
disabled, and production's ignore rule restricts builds to `main`; retain these
settings. The release uses one `main` push and its Git-triggered production build,
without creating a duplicate manual deployment. Remote `staging` is not pushed
as part of this operation.

## Preflight evidence

Fresh encrypted online pilot backup: `backups/participants/5109426faf57/`.
The copy restored original ownership, ACLs, global roles, application values and
history, then applied all four migrations under the reviewed non-superuser
operator boundary with the six actual managed DDL trigger definitions.

All **seven current accounts** matched across **161 resource/action checks** and
**1,235 record/action bindings**. Original values in 132 application tables, all
133 migration attempts, saved profiles/rules, assignments, sharing, offices,
financial rows and snapshots were preserved. Five new tables stayed empty;
unknown correspondence, acceptance, references and dates were not invented.
Both stored logo objects and both saved references verified. No historical pilot
quotations/orders in this snapshot need a participant/reference correction.

PostgreSQL 17.11 and the locale/provider match. The known ICU version difference
and incomplete reproduction of managed Supabase services retain P6A's limits;
P6B supplies the separate real hosted-service acceptance. The application did
not run on copied pilot data. Owned copy containers/networks were removed.

The reviewed copy driver uses bounded read-only probes and rebuilds planner
statistics only inside the isolated restore. For a final backup captured while
the runtime is frozen, it can restore LOGIN/connection settings only in that
isolated copy for ordinary-role probes, then restore the copy's captured flags.
It never reopens the live role or changes business grants for a rehearsal.

Required database, auth/root-domain and server Storage configuration is present.
Production intentionally has no fixed `AUTH_URL`/`NEXTAUTH_URL`; the verified
host-derived login behavior is retained. The existing saved pilot session passed
eight read-only API checks and authenticated Dashboard rendering. No client rows
were captured; only the Dashboard heading was inspected. No business writes,
fixture, seed or reset script was used against production.

Private preflight receipts, reviewed utility hashes, deployment/configuration
metadata and the exact candidate are under `tmp/participants/p6c-evidence/`.
Credentials, sessions, client rows and operator utilities remain ignored.

## Agreed-window execution

1. Revalidate the exact release source, current remote `main`, deployment,
   aliases, history, runtime identity and fresh credentials. Check for privileged
   concurrent writers, active privileged cron and prepared transactions. A
   changed target or failed check stops before the access barrier.
2. Capture the production runtime role's actual OID, login flag and connection
   limit. Block new logins and drain its sessions. Prove a fresh transaction-pooler
   login is rejected. Do not suspend tenants/users or alter their access grants.
3. Take another consistent encrypted database/role/storage recovery set while
   writes are blocked. Independently restore it and rehearse the four migrations
   against that exact final snapshot. Verify all current accounts/records rather
   than assuming the preflight's seven-account count. The online preflight backup
   does not replace this cutover backup.
4. Compare live frozen source fingerprints with that final backup. Encrypt the
   original row capture before migration. Run the candidate's actual
   `prisma migrate deploy` against the explicit production operator target.
   Reconcile original values/IDs, history, role metadata, owners, ACLs and RLS.
   Existing profiles/modules/data must not expand or be rewritten.
5. Fast-forward and push the pinned release to `main` once. Keep the access barrier
   through the Git build and automatic alias changes. Require READY for the exact
   project/commit; verify all production aliases and unchanged staging routing.
   Do not treat a static asset response as an authenticated application test.
6. Reconcile again before restoring the captured runtime settings. Verify a fresh
   ordinary-role connection. Use the existing pilot session for bounded read-only
   module/report/navigation checks; check platform-console isolation separately.
   Do not create business transactions or QA fixtures in production.
7. Record the final source, migration/deployment/access/recovery receipts and
   production smoke results. Keep post-release documentation local to avoid
   triggering an unnecessary second production build.

Templates remain unpublished until a tenant administrator reviews and publishes
the issuing company's wording. New staff document permissions are not added to
old profiles. No required-field setting, KYC upload, electronic signature or
ownership calculation is activated by the deployment.

## Stop and recovery rules

Before schema changes, a failed prerequisite can restore the captured runtime
settings and retain the old deployment. The private operator utility has a
guarded pre-schema abort for this case.

Once migration starts, retain the barrier on failed history, data, security,
build or alias checks. The encrypted original-row capture permits read-only
reconciliation to resume without rerunning a completed migration. Never repair
checksums/history, use `migrate resolve` to hide drift, add blanket grants or
silently force-update a branch. A failed receipt is not release approval.

Recovery needs the matched fresh database/role/storage set and captured previous
deployment/routing; application rollback alone does not reverse this transition.
Follow the tested ownership/ACL-preserving procedure and actual archive inventory.
Do not use old table counts/TOC IDs, omit owners or drop schemas with CASCADE.

After reopening, restoration can discard newly accepted client work. Preserve that
state and require an explicit recovery/data-loss decision before destructive
restoration. Investigate a material post-open verification failure promptly and
pause access if needed; never erase client work to make a check pass.
