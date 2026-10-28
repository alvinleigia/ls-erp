# R10 production cutover runbook

Prepared in phase 6E on 2026-10-28 and executed under explicit user approval in
phase 6F. See the [completed production release](PRODUCTION_RELEASE_R10.md).
The readiness review itself did not authorize execution. The pinned targets below
describe the pre-cutover state, with historical evidence in [the review](RELEASE_REVIEW_R10.md).
This operation interrupts login, reads and writes for every tenant using the
shared production runtime role. It is not a tenant suspension.

## Pinned targets

- Team: `leiwissen`, `team_Me0kX6NgE1RN4MNKRXXCfrsZ`.
- Production project: `ls-erp`, `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`; Git branch
  `main`. All three production project domains must be inventoried and verified.
- Production Supabase: `tehtbbifiimoplzlewzs`; operator settings come from the
  protected `.env.new-vercel`, independently checked against the live project.
- Last verified previous deployment: `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`, commit
  `adcffc892cfca57fdace3377a18d38887de56853`. Capture its current replacement if changed.
- Tested application: `525b8539b968a6858b403e28a48d9de494c5e8b4`, with the 132-entry
  `release-source-r10.json`. Record the exact approved final documentation/release
  commit and prove application equivalence; any application change needs review
  and affected acceptance again.

Do not infer the project from the root `.vercel` link. Use an explicitly linked
isolated checkout and authenticated CLI reads with the correct team/project.
Do not deploy GitHub's old `160becb` head as the reviewed candidate.

## Execution sequence after approval

1. **Prepare the window and source.** Record the approved commit, current GitHub
   heads, deployment/domain inventory and actual database prefix. Current
   production has 107 applied migrations, 25 pending and one rolled-back attempt.
   Reconcile any drift before proceeding. Inventory web/import/job/integration
   writers and privileged SQL sessions. Coordinate with tenant operators through
   an authorized channel; this runbook does not authorize messages to clients.

2. **Preserve configuration and recovery identity.** Keep production and staging
   values separate. Check the runtime pooler really uses `prisma_app` and the
   intended project. Capture role OID, login flag, connection limit, owners,
   memberships, schema/object/default ACLs, managed dependencies and asset
   references. Retain the current deployment/configuration for recovery. Do not
   bulk-import staging environment values or add a fixed authentication URL merely
   because staging has one.

3. **Establish the maintenance barrier.** Let work drain; stop every known writer.
   Under the verified operator, capture then disable runtime LOGIN/connections and
   terminate remaining runtime backends. Confirm zero runtime backends/prepared
   transactions and prove a new connection through the actual runtime transaction
   pooler fails. A different role or privileged writer must be stopped separately.
   If the barrier cannot be proved, stop before snapshot or migration. No schema
   changes or tenant/user status edits are needed to establish this barrier.

4. **Take and verify a fresh recovery set.** Use a consistent read-only snapshot
   for the ownership/ACL-preserving database archive, role/source inventories and
   every referenced storage object. Encrypt immediately; stream plaintext in
   memory. In an isolated environment, restore and verify fingerprints, ownership,
   grants, financial totals, asset bytes/references and the current baseline's
   readable populations. Rehearse the complete pending upgrade and reconcile
   translated permissions/access against this same snapshot. The earlier seven
   account IDs and fixed table counts are evidence, not a substitute for the
   current inventory. Failed receipts do not approve migration.

5. **Migrate and publish while frozen.** Apply the 25 reviewed pending migrations
   using the candidate's actual Prisma deployment path and explicit production
   operator target. Never edit checksums/history or use `migrate resolve` to hide
   drift. Verify the 132-migration target and complete data/access reconciliation.
   Fast-forward the approved release into `main` and push it once to trigger the
   verified production Git integration. Keep the runtime barrier in place through
   build and automatic alias changes. Avoid a duplicate manual deployment of the
   same commit. Synchronizing remote `staging` is a separately recorded approved
   push, with its own staging build; never force-update either branch.

6. **Verify before reopening.** Require READY for the exact approved commit and
   production project. Verify every inventoried production domain points to that
   deployment. Check schema/history, preserved data/access, runtime attributes,
   storage and configuration. Do not describe static assets/provider checks as an
   authenticated workflow test: runtime login is deliberately blocked at this point.
   Unexpected migration, build, alias or reconciliation results keep the freeze in place.

7. **Reopen and smoke-test.** Restore the captured runtime role settings rather
   than assuming LOGIN/-1. Use fresh production tenant sessions to check existing
   pilot records, navigation, role/team/office restrictions and representative
   read-only reports. Do not create QA fixtures or business transactions in
   production. Check errors and retain completed receipts. Reclose access and
   assess recovery if a material boundary or data-preservation check fails.

## Recovery decision

Before reopening, recovery uses the matched fresh database/role/storage recovery
set and captured previous deployment/configuration. Restore only through the
reviewed ownership/ACL-preserving procedure derived from that archive's own
inventory; R5 table counts, TOC IDs and omission lists are not an R10 recipe.
Unknown owners, managed dependencies or restore failures require review. Do not
drop schemas with CASCADE, omit ownership/ACLs or add blanket privileges.

Application rollback alone is not a database rollback for this release. Keep all
writers blocked until the matched source state, migration history, security
catalog, stored assets and previous deployment/domain routing are verified.

After reopening, a pre-cutover restore could discard newly accepted client work.
Capture that state, assess a forward fix or a reviewed recovery plan, and obtain
an explicit data-loss decision before destructive restoration. Retain all
original and failed evidence. Never reopen merely because the build succeeded.
