# R10 production release - phase 6F

Completed on 2026-10-28 after the user's explicit approval to start maintenance,
take fresh recovery artifacts, apply the 25 migrations, push the reviewed release
to `main` and deploy. Application access was reopened after approximately ten
minutes. Final audit passed at 07:29 UTC / 12:59 Asia/Kolkata.

## Released source and targets

- Release commit: `f9e24db1812e069845d248b345b50b48fcd2e32e`, pushed to GitHub `main`
  by fast-forward. This is the reviewed application candidate `525b853` plus the
  documented acceptance/release evidence; application code did not change during cutover.
- Production project: `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`.
- Production deployment: `dpl_5an58aZq3r8VUYi785v6WV7ddYK1`, READY for the exact
  released commit. The existing Git integration built it after the approved push;
  no duplicate CLI deployment was created.
- Verified production domains: `erp.ewissen.in`, `leiwissen.leigia.com` and
  `ls-erp-phi.vercel.app`. All three point to this deployment.
- Supabase project: `tehtbbifiimoplzlewzs`. Final history is **132 applied
  migrations in 133 attempts**, zero pending and one original rolled-back attempt
  retained unchanged. No history repair or `migrate resolve` was used.

The three staging domains still point to their previously verified deployment
`dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`. Remote `staging` was not pushed in this
production operation. Post-release documentation is committed locally without
triggering another production build.

## Maintenance and fresh recovery

The operator and actual runtime transaction-pooler identities were checked before
the freeze. The runtime role's original OID, LOGIN flag and connection limit were
captured. Other active privileged work and prepared transactions were checked;
runtime connections were drained/terminated, and a fresh pooler connection was
proved unable to log in. No tenant/user status was changed to establish maintenance.

Fresh protected recovery set: `backups/r10/541042ae5789/` (ignored by Git).
It contains the consistent encrypted database, role and source archives, two
stored branding objects and both saved asset references. Plaintext archives were
streamed in memory; encryption keys use Windows CurrentUser DPAPI as previously
agreed. This is application/role/storage recovery, not complete Supabase recovery.

An isolated restore verified all **117 original application tables**, ownership,
ACLs, role attributes/memberships and stored asset bytes/references. A fresh-copy
upgrade then applied the same 25 migrations under the representative non-superuser
operator boundary and exact six managed DDL trigger definitions.

The restored copy initially matched the deliberately frozen runtime role. Its
LOGIN/connection settings were restored locally, without changing privileges,
only for ordinary-role access probes. The live runtime stayed frozen throughout
this rehearsal. PostgreSQL versions match at 17.11; the previously documented ICU
version difference and incomplete managed-service reproduction remain explicit.

The upgrade preserved original values/IDs and translated all five staff policies
and grants. Seven existing accounts matched across 42 resource-read decisions
and **459 account/record bindings**. Native foreign-tenant reads remained denied.

## Live migration and deployment verification

The live source fingerprints were compared with the fresh backup before migration.
The actual Prisma deployment applied all 25 migrations once. Live reconciliation
then verified the original 117 tables, five translated staff grants/policies,
870 rule entries and all 108 original history attempts. Global database roles and
memberships were unchanged.

A verification utility initially lacked the TypeScript loader after Prisma had
completed successfully. Read-only reconciliation was resumed from the encrypted
pre-migration row capture with the loader enabled. The migrations were not rerun,
and access remained blocked until reconciliation and deployment verification passed.

The approved `main` push triggered the production Git deployment. Before reopening,
the exact project, commit, READY state and all three production domain assignments
were verified. Runtime LOGIN/connection settings were restored to their captured
values and a fresh runtime pooler connection was verified.

## Post-release checks

- Live ordinary-role probes matched all seven accounts, 42 resource decisions and
  459 record bindings against the fresh restored baseline; foreign-tenant reads
  remained denied.
- The existing pilot tenant session passed eight read-only API checks, including
  dashboard, enquiries, opportunities, projects and quotations. Platform tenant
  provisioning remained forbidden for that tenant session.
- An isolated Chrome context displayed the authenticated production Dashboard
  without page errors or body overflow. Only the heading was captured and
  inspected; client rows and browser state were excluded from evidence output.
- Fresh platform-admin credential sign-in passed. Tenant/organization console
  reads were allowed and CRM business access from the platform tenant was denied.
- Final migration checksums/history, original runtime role/OID, complete global
  roles/grants and **117 original object owners/ACLs** matched the expected state.
- Both baseline storage objects downloaded with the exact saved byte lengths and
  SHA-256 hashes. No business transaction or QA fixture was created in production.

This smoke test is bounded read-only production acceptance, supported by the
broader staging phases 6C-6D6. It does not claim every browser form or directly
observed seven-day invitation expiry was tested on production.

## Evidence and recovery boundary

Private operational state and completed receipts are under
`tmp/industry-release/phase6f/cutover/`. The fresh backup directory retains the
restore/upgrade receipts, encrypted pre-migration rows and encrypted before/after
read-population evidence. Actual cutover utility hashes and receipts are retained
with that backup; credentials, environment values and session cookies are excluded.
Owned rehearsal containers/networks were removed; unrelated containers were untouched.

Previous deployment: `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`, source
`adcffc892cfca57fdace3377a18d38887de56853`. The fresh backup includes the frozen
role state; its captured original runtime settings are retained with the cutover
state for any reviewed recovery.

Production is open. Restoring the pre-cutover backup after new client work can
discard that work and needs an explicit recovery/data-loss decision. Application
rollback alone does not reverse this schema transition. Follow the reviewed
ownership/ACL-preserving procedure and actual archive inventory, not old R5 TOC
IDs or table counts. Retain the original history and all failed/completed evidence.
