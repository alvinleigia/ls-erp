# R10 staging release and initial acceptance

Phase 6C completed on 2026-10-28 (Asia/Kolkata). The staging application and its
database now run R10. Production was checked read-only and remains unchanged.
This checkpoint does not approve a production release or complete module UAT.

## Deployed source and target

- Candidate: `525b8539b968a6858b403e28a48d9de494c5e8b4` on local `staging`.
- Vercel project: `ls-erp-staging`, deployment
  `dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`, READY.
- Stable aliases: `ls-erp-staging.vercel.app`,
  `ls-erp-staging-qa-a.vercel.app` and `ls-erp-staging-qa-b.vercel.app`.
- Supabase reference: `oyhsrcmjhwxhvepdbcdc`. Database URLs were checked against
  this fixed target; the saved Storage endpoint was verified against the same
  project. No bulk environment replacement was performed.
- Actual starting history: 111 applied migrations, no rolled-back attempts;
  21 pending. Final history: 132 applied, no pending or rolled-back attempts,
  with checksums verified against the separate R10 source inventory.

The renewed CLI login resolved the 403 blocker. The exact live production
deployment was freshly verified as `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`, revision
`adcffc892cfca57fdace3377a18d38887de56853`. Its difference from the recorded
pilot access baseline `160becb79d10b112ea1364b3b66c300fc808eeb9` is confined to
`auth-proxy.ts`, `auth.config.ts`, `auth.ts`, `next.config.ts` and `proxy.ts`.
The previous staging deployment similarly differs from its recorded baseline
only in those five hosting files. These identity checks resolve the stale-login
uncertainty in phase 6B2; they do not replace the copied-data access comparisons.

## Recovery, rehearsal and cutover

The encrypted staging preflight backup `backups/staging-r10/d0e1c2c95b18` restored
into an isolated PostgreSQL cluster with full application ownership/ACLs. Actual
Prisma deployment then applied all 21 pending migrations. All 121 original
tables retained their values under the reviewed translations. Existing 44
profiles, 78 assignments, 82 user policies, eight sharing policies and two sharing
grants were preserved. The three stocked products and three receipt postings
passed their preservation checks.

Before/after probes used the recorded staging baseline's own predicates and
ordinary non-BYPASSRLS runtime authority. All 131 accounts matched across six
resource families: 786 read decisions and 278 account/record bindings. Deliberate
foreign-tenant reads returned no records. Original owners/ACLs and global role
grants matched. Six actual managed DDL event triggers were replayed unchanged in
this rehearsal. PostgreSQL 17.11 and locale settings match; ICU versions differ
(153.121 hosted, 153.128 local), and full Supabase services were not reproduced.
Staging had no frozen roster history rows; that preservation path retains its
separate synthetic evidence rather than claiming a real-data case here.

The cutover temporarily disabled the staging runtime role and drained its
connections. A fresh encrypted backup, `backups/staging-r10/7d4122d54c10`, then
passed an independent isolated application restore: 121 tables, full ownership
and ACLs, role attributes/memberships, 11 stored objects and eight saved asset
references verified. Its source fingerprints matched the rehearsed snapshot.
Role passwords were not copied, and this is not complete Supabase recovery.

The native migration command applied all 21 migrations without history repair or
`migrate resolve`. Live reconciliation checked the original values and persisted
access/sharing state before reopening the application. A clean detached worktree
at the candidate revision was built on Vercel with aliases initially withheld.
The READY deployment was then promoted and all three staging aliases verified.
The runtime role's original LOGIN and connection-limit settings were restored;
fresh transaction-pooler access succeeded. The recorded access interruption was
approximately 3 minutes 15 seconds. Production aliases were checked before and
after cutover and did not move. No GitHub push was performed.

Two preliminary freeze attempts stopped before schema changes and restored
runtime access. The provider rejects a blocked runtime login with its specific
`XX000` / `EAUTHQUERY` response; the probe was corrected to recognize that response
only after proving the connection worked before blocking and the role/backend
state was blocked. These attempts remain in private evidence, not success receipts.

## Initial hosted acceptance

The candidate passed its local production build. Hosted checks then used only
the existing isolated synthetic QA tenants, ordinary authenticated APIs and
separate Chrome contexts. No hosted fixture, seed or database reset was used.

All 18 source/history/storage regression tests also passed with zero skips, and
the R10 source inventory and Git whitespace checks passed. Only documentation
changed after the deployed candidate; no application fix was needed here.

The completed acceptance receipt records **45 checks**, including cleanup and
five desktop/mobile browser captures:

- Admin and Staff sign-in, module/dashboard reads and office membership reads.
- Staff denial of company, office and collaborator administration.
- Child-company creation, duplicate rejection, cycle rejection, successful edit
  and stale-version rejection; office creation and archive ordering.
- Tenant Admin can select active tenant offices by design. Creating an office
  does not grant it to ordinary Staff; unauthorized selection is rejected without
  changing that Staff user's saved preference.
- A second QA tenant cannot read the first tenant's company, office or collaborator.
- Creating a collaborator does not create a user/login implicitly; login-list
  access and the collaborator's supervisor relation were exercised.
- Companies and collaborators render on desktop and 390-pixel mobile Chrome;
  the dashboard renders on desktop. Captures were visually inspected. Mobile
  tables retain internal horizontal scrolling, with no page-body overflow.

The first acceptance attempt incorrectly expected the Tenant Admin office
exception to behave like ordinary Staff access. The test was corrected against
the existing canonical policy, without changing application access rules. Its
synthetic records and the successful run's records were archived through the
ordinary APIs. Failed-attempt evidence is retained separately.

Final read-only verification confirmed all aliases, candidate revision, complete
history and the non-superuser/non-BYPASSRLS runtime role. Disposable rehearsal
containers and networks were removed. Browser sessions/credentials and raw
business data are not committed.

## Evidence and remaining work

Private evidence is under ignored `tmp/industry-release/phase6c`:
`staging-cutover-state.json`, `acceptance.json`, `final-state.json`, deployment/
migration/build logs and `ui` screenshots. The encrypted backup folders retain
their own backup/restore and rehearsal receipts. Only completed receipts establish
success; prior failed attempts do not. Backup keys remain protected with this
Windows account's DPAPI, so these are local recovery copies, not independent
off-machine disaster-recovery backups.

Next is wider hosted acceptance: multiple-team managers, office grants/revocation,
external login lifecycle, source/report/dashboard attribution, exports and the
operational/financial write workflows. These retain earlier local/native test
evidence but are not all exercised by this initial hosted check. Production still
requires its own fresh target/recovery checks, authorized maintenance window and
release decision. This document is a staging checkpoint only.
