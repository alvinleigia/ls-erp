## Industry-neutral R5: released and live tenant reads verified (2026-10-18)

Production release 740cfc527a47aae55b397c5572fde080500e42b5 is live on the verified
leiwissen/ls-erp project. Both planned migrations applied (97 to 99). A fresh
encrypted backup was restored in isolation and checked before migration; existing
data, financial totals, identities, permissions and relationships reconciled.
Runtime access was restored to its original role attributes. Existing Vercel
environment settings were retained and the local project link was corrected.

The tenant administrator subsequently signed in to the dedicated test browser.
Live verification passed: dashboard connection; eight CRM desktop/mobile checks;
13 project/enquiry/conversion-form/settings/list checks; and five disabled-module
API denials. Screenshots were inspected. No client record/configuration writes were
performed by these UI checks. Earlier runtime checks covered seven existing user
contexts with 42 successful reads and six expected platform-scope denials.

R5 is closed. The user chose to proceed without further client write-flow testing.
The conversion form was opened without saving; quotation/payment-plan create,
version and PDF behavior retain isolated-test evidence. No client pipeline setup
or synthetic client record creation is pending as a release requirement.

Private receipts and screenshots remain under ignored tmp/industry-release and
backups/r5/643fd6867e3b; no customer records or credentials are included here.
The earlier preparation entries below are historical, not pending release steps.

# R5 — Target inventory and release rehearsal

## 2026-10-18: application recovery ownership and permissions verified

Read-only catalog inventory confirmed application ownership and the recovery
operator's permissions. The database owner is postgres; that role is non-superuser
with BYPASSRLS/CREATEROLE/CREATEDB, but cannot SET ROLE to supabase_admin. The backup
contains seven default-ACL entries, three owned by supabase_admin. A full schema
drop/default-ACL replay is therefore unsuitable for this operator.

Updated the [cutover runbook](INDUSTRY_NEUTRAL_CUTOVER.md) with a selective restore
list that preserves app/public schemas, schema ACLs/comments and all default ACLs.
It retains all object ownership and object ACL restore entries. The 12 excluded
entries were reviewed by type/schema/owner, not suppressed after a restore error.
The list must be regenerated and reviewed against the fresh cutover backup.

An isolated rehearsal bootstrapped matching source permissions, then applied both
release migrations and restored over the upgraded copy as **non-superuser postgres**.
Recovery succeeded without --no-owner/--no-acl or added managed-role permissions.
Before and after owners/ACLs match source metadata across two schemas, 104 tables,
22 functions and seven default ACLs. ACL entry order is the only normalization.
Data/schema/migration history also match exactly: 103 application tables plus
history, 97 baseline migrations, zero FK orphans. Both new terminology tables were
asserted empty before removal. Six source event-trigger functions were exercised
locally and remained unchanged. All containers/networks were removed.

The initial fixture bootstrap attempted to demote PostgreSQL's bootstrap superuser,
which PostgreSQL correctly rejected. A separate bootstrap account fixed that setup.
The next setup comparison exposed missing implicit PUBLIC USAGE after recreating
public; keeping the initialized schema fixed it. Neither issue changed application
code or production. These findings support preserving existing managed schema
state in the final recovery procedure.

Evidence: `r5-recovery-permissions-1792318395690.json` and
`9d534e25f642-acl-1792318584857-{before-permissions,after-permissions,before-data,after-data,result}.json`
under protected tmp/industry-release/. The reviewed TOC is the matching
`-restore.list`. Recovery helper/probe and these receipts are retained with the
project-local encrypted backup. No credentials or plaintext data dump were printed
or saved by this check; only catalog metadata and local comparison reports.

This closes the application ownership/ACL recovery gap identified in the previous
checkpoint. It does not reproduce all managed extensions/services; fresh source
inventory and the live pooler freeze probe remain execution-time gates. Current
metadata shows no external-schema foreign keys into application tables. Existing
PC-bound backup and ICU-version limitations remain documented.

Next: agree the maintenance window and explicit release scope, reverify the final
target/source, freeze/drain, take and restore-verify a fresh backup, then apply
the two migrations and deploy the matching revision. Production has not changed;
no commit, push, relink or deployment was performed.

## 2026-10-18: hard-freeze and application-data rollback rehearsed

Prepared [the cutover procedure](INDUSTRY_NEUTRAL_CUTOVER.md), covering target
verification, platform-wide downtime, writer inventory, runtime login freeze,
backend draining, fresh encrypted backup, exact migration/deployment checks,
reopening and failure paths. No production maintenance switch or environment
change was introduced; application code and its 804-path fingerprint are unchanged.

The reusable isolated runner now supports `--cutover`. Seven tests/subtests passed
with no skips, including an operator matching production's non-superuser privilege
shape: CREATEROLE, ADMIN on the runtime role and pg_signal_backend, but no SET ROLE.
They prove NOLOGIN/connection limit zero blocks new connections, existing sessions
must still be drained, termination rolls back an uncommitted save, operator DDL
and read-only reconciliation remain possible, and reopening/aborting restores the
original connection limit and unchanged grants. Evidence:
`tmp/industry-release/ls-erp-history-0875b9bbb713.log`.

A read-only source authority check confirmed that privilege shape, current runtime
LOGIN/limit -1, and zero prepared transactions. It made no role changes and
terminated no sessions. Evidence: `r5-cutover-authority-1792317704970.json`.
Supavisor's actual behavior must still be probed during the approved freeze; local
direct-Postgres tests cannot certify a hosted pooler's cached connections.

Restored the protected client archive in isolation, applied the exact two release
migrations (97 to 99), and confirmed a repeated deployment was a no-op. Then
asserted both newly created terminology tables empty, removed only those two local
tables and restored the archive over the upgraded copy using pg_restore clean,
single-transaction mode. All 104 source tables including migration history match,
as do financial/schema/RLS evidence; zero foreign-key orphans. The prior two
explicitly reviewed CHECK-expression reparses remain the only accepted formatting
differences. A first helper attempt had a dollar-quoting error and aborted before
changes; the corrected rerun passed. This was helper syntax, not a product defect.

Evidence: `9d534e25f642-upgrade-1792317879062-result.json` and
`9d534e25f642-rollback-1792317974707-{restore-result,before}.json` under the protected
evidence directory. The restored container/network were removed afterwards.

This rollback deliberately used a local owner with source ownership/ACL application
omitted. **Production ownership/ACL recovery remains to be verified** before
executing an in-place production rollback or approving cutover. Source runtime
grant compatibility already passed; that is not proof of full managed Supabase
permission restoration. The runbook explicitly distinguishes the two. No new
production changes are authorized by the document.

Targeted lint, migration/schema source verification and whitespace checks pass.
No application build rerun was required for this test/runbook-only change.
Next: finish production recovery-permission review, then agree the maintenance
window and take the fresh cutover backup. Nothing committed, pushed or deployed.

## 2026-10-18: populated queries and source permission compatibility passed

The additional sales, quotations, dashboard and custom-field suites passed
**41/41 tests, zero failures or skips**, in a fresh internal-network Docker
database with all 99 migrations. No client data, hosted environment files or
external services were supplied. Evidence:
`tmp/industry-release/ls-erp-query-38d25512336c.log`.

- Custom-field filtering over 10,000 typed values used an index under EXPLAIN
  ANALYZE. The service returned five of ten matching rows in 13 statements;
  the observed local sample was 103.2 ms service / 0.07 ms indexed SQL.
- A populated quotation list with 1,007 rows returned five rows using eight
  statements and did not fetch quotation revision payloads.
- Tests verified batch custom-field export, filtered sales totals/CSV drilldowns,
  module-gated dashboard content, concurrent tenant isolation, document snapshots,
  payment-plan activation and concurrent document updates.

These are bounded-query and correctness checks, not production latency promises
or a load test of every endpoint. They supplement the earlier 84 restored-client
baseline/current service comparisons and cover populated sales data absent there.

### Runtime role and new-table grants

A TLS-verified, read-only connection using `.env.new-vercel` runtime credentials
confirmed `prisma_app` is neither superuser nor RLS-bypass, cannot create roles or
databases, owns no application tables and has no TRUNCATE access. It can read all
104 current public tables and execute the app isolation functions. This confirms
the local runtime credential's target and access, not equality with masked Vercel
values. Only catalog metadata and 15 synthetic collation strings were queried;
no client rows were read or changed in this check.

Source table defaults grant SELECT/INSERT/UPDATE/DELETE to the runtime role for
tables created by postgres in public. Reproduced these defaults **before** replaying
all 99 migrations in a fresh local database. Both new terminology tables inherited
all four expected privileges without post-migration blanket grants; TRUNCATE
remained denied. All **nine terminology integration tests passed** through the
non-bypass runtime role, including scope/permissions and configuration updates.

This database used the source's ICU provider and en-US locale. Ordering and lower
casing matched for all 15 synthetic samples. ICU collation versions differ
(source 153.121, local 153.136); this is sampled compatibility, not exact managed
Supabase environment reproduction. The release does not alter source collation.

Evidence: `r5-runtime-environment-1792317381605.json` and
`ls-erp-compat-0cd360afbeca.log`, under protected tmp/industry-release/. The first
catalog query used an older PostgreSQL locale column name and failed read-only;
the corrected query handles the PostgreSQL 17 name. All temporary test containers
and networks were removed.

### Configuration review and next release step

The six missing local values do not all represent current runtime dependencies:
the two NEXT_PUBLIC_SUPABASE variables have no consumers in application source.
SMTP_PORT defaults to 587; the verified Vercel inventory lacks SMTP_HOST and
MAIL_FROM, so port alone cannot enable outbound email. Calendar activation and
license values and AUTH_SECRET remain private settings retained in Vercel.
No setting was recovered by guessing, copied from the old database environment,
rotated or changed. Do not overwrite production configuration from the incomplete
`.env.new-vercel`. Recreating the deployment outside the existing Vercel project
would still require recovery/replacement of its private settings.

The next step is **controlled cutover preparation**: a concrete server-side write
freeze/drain and rollback procedure, final source/deployment identity checks,
then an agreed maintenance window and fresh backup. There is no implemented
maintenance switch in the current proxy; requesting users to log out alone does
not meet the write-freeze requirement. Existing local backup/Windows-account and
ICU-version limitations remain recorded. No production writes, environment change,
commit, push, relink or deployment occurred.

## 2026-10-18: historical upgrade fixtures passed; local recovery retained

All four previously deferred upgrade checks now pass. The new repeatable runner
`node scripts/test-historical-upgrade.cjs` verifies the release manifest, creates
an empty isolated PostgreSQL database and replays all **99 migrations**, inserting
synthetic records before the relevant historical upgrades. Both existing CRM and
Real Estate integration suites pass: **98 tests, zero failures or skips**.
Checks cover activity IDs/completion/ownership, tenant-scoped source normalization,
the additive project upgrade, and property choice/hierarchy/context preservation.

The runner uses installed Docker images pinned by immutable IDs, an internal
network, no host database port and read-only source mounts. No environment files,
client backup data or hosted credentials enter the containers. Tests use a
non-superuser/non-bypass runtime role; setup uses a separate database owner.
Temporary containers/networks were removed. This is historical SQL replay, not
a substitute for the separately passed Prisma deploy rehearsal on client data.

Evidence: `tmp/industry-release/ls-erp-history-788c8e033e72.log`. The first run
also passed all 98 tests but its runner rejected Node's default human-readable
summary; explicitly selecting the TAP reporter fixed reporting. No application
change was needed. Targeted lint and source/schema verification pass.

The user chose to retain recovery material **inside the project**. Copied the
encrypted archive, DPAPI-wrapped key, metadata and restore evidence to ignored
`backups/r5/9d534e25f642/`, with ACL access limited to the current Windows account
and SYSTEM. All six copied file checksums match. Decrypting the copied archive
in memory verified its original checksum, byte count and PostgreSQL signature;
no plaintext customer dump was written. A README and restore-helper copies
document isolated recovery. The original protected copy remains unchanged.

This satisfies the chosen local storage location. It is **not independent
disaster recovery**: both copies are on this PC and DPAPI still requires this
Windows account. The user did not request an external copy. Retention review is
2026-10-25, with no automatic deletion. The archive is the earlier tested snapshot,
not a fresh cutover backup or a full Supabase platform backup.

Production environment metadata shows 14 keys, of which eight have nonempty
local values in `.env.new-vercel` (presence only; equality was not established).
Six are absent/empty locally: `AUTH_SECRET`, `NEXT_PUBLIC_ENABLE_CALENDAR_VIEWS`,
`NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY`, `SMTP_PORT`, `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. All six are marked sensitive by Vercel.
Its installed CLI explicitly reports that production secret values cannot be
pulled. Older `.env` candidates are unverified and use a different Supabase
project; no values were copied, printed or changed. Sanitized inventory:
`tmp/industry-release/r5-recovery-env-inventory.json`.

Remaining R5 work: broader populated-query/performance checks, source locale/grant
equivalence, configuration recovery and controlled cutover preparation with a
fresh backup. Local-only storage remains an explicit recovery limitation, not an
unanswered storage request. No production writes, commit, push, relink or deploy.

## 2026-10-18: production build and full local browser suite passed

Fresh production build and TypeScript checks passed. The full existing local
browser suite passed **58/58 tests, zero failures or skips**, using a separate
synthetic fixture database and the non-bypass application runtime role. Covered
real sign-ins, tenant/role access, module switches, enquiry import/corrections,
sales conversion, quotations/PDFs/payment plans, bookings/inventory/workforce,
industry isolation and terminology changes preserving drafts and stored IDs.
Some targeted UI refresh/failure scenarios use the suite's existing interception;
this does not claim every check is an unmocked end-to-end production integration.

The launcher empties configured environment keys before setting local database,
auth and mail-disabled settings. No hosted session, client backup data or hosted
credentials were passed to the browser suite. The client-copy service checks below
and this synthetic workflow suite are separate complementary evidence.

The first build attempt encountered the extracted historical source directory
under tmp, which TypeScript included in its search. Moved that comparison-only
source outside the repository and reran successfully. No application fix or
TypeScript exclusion was introduced. Baseline source remains available in the OS
temporary directory for reproducing the comparison, and its Git archive is kept.

Inspected five representative screenshots: CRM dashboard, mobile import mapping,
module-off opportunity filters, quotation payment schedule and mobile project
activities. Their layout was readable with expected module content. This is a
sampled visual review, not certification of every viewport or screenshot.

Evidence: tmp/r5-build.log, tmp/r5-workflows.log, test-results/local-access and
protected tmp/industry-release/r5-runtime-verification.json. Source receipt
r5-application-source.json pins 804 application/source/asset paths at aggregate
SHA-256 7517de9edd4a2caa68b0a006ead56a1a41ba814a36e29f639475744f14587025;
all hashes still match after the run. Migration/schema source verification passes.
This fingerprint does not include environment values or establish a release commit.

Remaining: historical upgrade fixtures, broader query/performance and source
locale/grant equivalence, independent recovery coverage and maintenance/cutover
preparation. The default browser suite does not run the deferred historical SQL
fixtures, so its zero skips do not close those gates. No production write, commit,
push, relink or deployment was performed.

## 2026-10-18: existing-account service parity and activation gates

Recreated the protected client restore in an internal Docker network, verified
all source fingerprints, and reapplied the two release migrations with a repeat
no-op. Existing data remained unchanged. Evidence:
`9d534e25f642-upgrade-1792315801091-{before,after,result}.json` under the
protected ignored `tmp/industry-release/` directory.

### Existing data and query parity

Ran the exact Git baseline `5f13238` and current application service composition
against the same upgraded copy, using the installed Prisma client/driver adapter
and a SELECT-only, non-superuser, non-bypass role with read-only transactions.
The runtime container had no outside network, host database port, production
environment files, SMTP configuration or workers. Only required source folders
and installed dependencies were mounted read-only. Both variants used the same
dependency installation; this is source-behavior comparison, not a reproduction
of the old Vercel bundle or dependency lock resolution.

- **84 comparisons passed**: seven existing active accounts (admin, manager,
  staff, including the platform account), six lists and page sizes 1 and 20.
- Contacts, enquiries, opportunities, activities, projects and quotations match
  in status, total, returned IDs and complete JSON response fingerprints.
  Activity `serverTime` is validated as a timestamp and excluded because each
  request intentionally generates a new time. No stored timestamp is excluded.
- 72 reads allowed and 12 platform-account reads denied in each variant.
- Query counts and EXPLAIN plan structure (node, relation, index, estimated rows)
  match. Successful SELECT counts: contacts 4, enquiries 15, opportunities 14,
  activities 10, projects 4 and quotations 5. Transaction/scope statements are
  counted separately. None increases between the two tested page sizes.
- Client coverage includes 21 contacts/enquiries, seven top-level projects and
  six activities. There are **no opportunities or quotations in this snapshot**;
  populated sales/document workflows require separate synthetic tests.

Evidence prefix: `9d534e25f642-services-1792315946294` (baseline, current,
result and summary JSON). The earlier attempt only differed on activity request
time; the final run excludes that exact volatile field and compares everything
else. One prior helper run truncated stdout; the helper now flushes its output
before exit. Neither issue required changing application code.

Plans are estimated EXPLAIN plans, not EXPLAIN ANALYZE. Timings are single local
samples with TypeScript-loader warm-up; they do not certify Vercel latency,
large-dataset performance, source collation, or production-role grant equivalence.

### Activation and access

**90 additional service assertions passed** against current code. Covered tenant
and platform module switches for CRM, Real Estate, Sales Documents and Payment
Plans; suspended tenant and user; a user supplied with the other tenant identity;
a custom role with no reads and then contacts-only reads; and restored access.
Payment Plans off leaves quotation listing accessible with its flag false.
Platform disallowance also clears enabled, respecting the database constraint.

These checks temporarily changed configuration only in the isolated copy through
a separate setup connection. Application reads continued through the restricted
runtime role. Original flags, statuses and role assignments were restored in
finally blocks; temporary access roles were removed. A complete final capture
matches the post-migration snapshot exactly (all 105 application tables), proving
stored client data/configuration was unchanged. Evidence:
`9d534e25f642-gates-1792316088430.json`.

The client-copy container and internal network were removed afterwards. Protected
backup/evidence remain. No hosted writes, commit, push, relink or deployment.
Full build/browser workflow, deferred historical fixtures and independent recovery
coverage remain separate release gates.

## 2026-10-18: correct Vercel account and live deployment verified

The user completed a fresh CLI device authorization. Read-only Vercel API
requests now confirm account `leiwissen-3468`, team `leiwissen`
(`team_Me0kX6NgE1RN4MNKRXXCfrsZ`) and project `ls-erp`
(`prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`). This supersedes the login blocker below.

The `erp.ewissen.in` alias resolves to production deployment
`dpl_FjvreJBMLNBi4gNJtywYeNcngpzd`, status `READY`, Git main revision
`5f1323807141f3785e1a8bd45b39e54cbc727c53`, matching the release baseline.
The project is connected to `alvinleigia/ls-erp`. Both `erp.ewissen.in` and
`leiwissen.leigia.com` are verified domains on this project. Sanitized receipt:
`tmp/industry-release/vercel-deployment-verified.json`.

The local `.vercel/project.json` still references the old team/project and was
not changed. Future release commands must explicitly target the verified project
or deliberately relink before deployment. No environment values were retrieved,
no hosted database writes were made, and nothing was committed, pushed or deployed.
This verifies deployment identity only; application/runtime, performance and
recovery gates remain open.

## 2026-10-18: renewed CLI session accesses the old Vercel team only

After the user reported signing in, direct requests initially still used an
expired cached token. Running cached Vercel CLI 63.1.0 `whoami` refreshed the
session successfully. Its background version-check worker emitted a timeout,
but identity retrieval and subsequent authenticated API requests succeeded.
No credential values were printed or copied into project files.

Read-only API verification established:

- Current login has access to `alvin-araujos-projects` only.
- That team's `ls-erp` project is the project ID in the old local `.vercel` link.
- Its domain list contains `salon.leigia.com`, `*.salon.leigia.com` and
  `ls-salon.vercel.app`; it does not contain `erp.ewissen.in`.
- Access to the `leiwissen` team returns 403. Newer deployment receipts point to
  `leiwissen/ls-erp`, whose current deployment identity remains unverified.

The user was asked to sign in with access to the newer team. No project relink,
environment update, deployment, hosted database operation, commit or push was
performed. Local database rehearsal evidence remains valid; this blocks current
deployment verification, not independent local checks.

## 2026-10-18: historical checksums reconciled; restored-client migration passed

### Root cause and correction

All twelve previously unexplained checksums match the **current raw migration
files byte-for-byte**, and also match the copies retained under
`tmp/release-rehearsal/migrations/` from October 4. Each file has LF line endings
except for its final CRLF. Normalizing that final newline produces exactly the
SQL in Git baseline `5f13238` and the existing manifest LF checksum.

The earlier investigation compared normalized Git/format variants but missed this
mixed-newline encoding. This was a gap in the release verifier, not changed SQL
or altered database history. Evidence: private
`tmp/industry-release/mixed-newline-provenance.json`.

The manifest now pins `sha256LfFinalCrlf` for those twelve reviewed files only.
Source verification reconstructs that exact byte variant from the unchanged LF
SQL and rejects a mismatched hash; it is not a free-form history exception.
Historical SQL, the existing LF/CRLF hashes, the Prisma schema and live migration
history remain unchanged. All **97 applied baseline migrations now reconcile**.
This supersedes the checksum blocker recorded in the earlier checkpoints below.

### Exact migration rehearsal on restored client data

Restored the protected artifact `9d534e25f642` into a fresh isolated PostgreSQL
17.11 instance and reverified the source data. Ran the project's installed Prisma
CLI against that copy with a pinned matching Linux schema engine. Both runtime
and migration connection variables were restricted to the same localhost
rehearsal database inside the container network; no hosted credentials or `.env`
files were mounted into the runner. No application or mail/worker was running.

- Prisma deployed the two pending migrations: **97 to 99** applied migrations.
- Application tables increased **103 to 105**, exactly the two empty terminology
  tables allowed by the release manifest.
- Full comparison passed: existing per-tenant rows, unique identities, complete
  content fingerprints, stored financial totals and existing schema/security
  match, apart from the reviewed default-shift index replacement.
- No foreign-key orphans; the new tables have the expected forced RLS policies.
- A second `prisma migrate deploy` reported no pending migrations. A fresh
  capture after that second command was identical to the first after snapshot.
- No hosted SQL query or mutation was needed for this reconciliation/rehearsal
  batch. The source backup and original migration history were preserved.

Protected evidence prefix:
`tmp/industry-release/9d534e25f642-upgrade-1792314805675` (`-before.json`,
`-after.json`, `-deploy.log`, `-repeat.log`, `-result.json`). One-off helpers:
`tmp/r5-upgrade.cjs` and `tmp/r5-local-prisma.config.ts`.

### Access regression and limits

**30 database isolation assertions passed** on the upgraded client copy using a
role with neither superuser nor RLS-bypass privileges. Covered both tenant scopes
for users, contacts, enquiries, opportunities, projects, quotations and tasks;
both new terminology tables were populated with transaction-local probes to prove
cross-tenant hiding and rejection of cross-tenant inserts. Missing tenant context
returned no scoped rows. All probes, role and grants rolled back. A final complete
capture matched the post-migration snapshot exactly.

Evidence: `9d534e25f642-restored-rls.json`; helper `tmp/r5-restored-rls.cjs`.
These checks prove database policy behavior, **not** the full application role,
module activation, browser workflow or query-performance gates. Source locale,
source grants and independent recovery coverage still need the work recorded in
the prior checkpoint. Disposable databases/containers were removed after checks;
the protected backup and reports remain.

Six checker unit/integration tests passed, with no skips; targeted ESLint,
source-manifest verification and whitespace checks passed. The added test accepts
the twelve exact encodings, rejects arbitrary or swapped hashes and retains
missing-checksum rejection. No application/UI change or new runtime migration was
introduced by this verifier correction.

### Deployment identity still pending

Preserved newer receipts point to Vercel team/project `leiwissen/ls-erp`, while
the local `.vercel` link still names the older project. The CLI credential file
was found under the standard Windows `Roaming/com.vercel.cli/Data` location;
authenticated read-only user/team API requests both returned **403**. No token
was printed, no project was relinked and no deployment was submitted. The user
was asked to sign in again to verify the current project and production revision.

Next: full application access/module/workflow and query-performance checks on a
properly matched isolated environment, independent recovery/deployment coverage,
then the agreed maintenance/cutover procedure. Nothing committed, pushed or
deployed. Ewissen's live records and migration history were not changed.

## 2026-10-18: protected application backup and restore verified

Created a consistent PostgreSQL 17.11 custom-format backup of `public` and `app`
from the confirmed project. `pg_dump` and the source fingerprint reader shared
an exported repeatable-read snapshot. Source connections were read-only with
verified TLS and bounded statement/lock waits. No hosted mutation or release
migration was run.

### Protected artifacts and scope

- Verified backup ID: **`9d534e25f642`**. Archive: **569,520 bytes** before
  encryption; SHA-256:
  `8afb9d254f8af46c8d20c430756d90a0af62c549038ed46a3fa12f858327cd6e`.
- Archive is AES-256-GCM encrypted; the random key is wrapped with Windows
  CurrentUser DPAPI. Plaintext archive bytes were processed in memory, not saved
  to a file. Protected files are under ignored `tmp/industry-release/`, with
  Windows access limited to the current user and SYSTEM.
- **Recovery depends on this Windows account/machine's DPAPI keys.** This is a
  local rehearsal backup, not independently recoverable off-machine disaster
  recovery. Establish a separate recoverable backup before production cutover.
- Retention review date: **2026-10-25**. No automatic deletion is scheduled.
  Keep the verified artifact until it has been superseded by a tested recovery
  backup; perform deliberate cleanup after the release decision.
- Application archive includes original ownership/ACL SQL and migration history.
  It is **not a full Supabase platform backup**: managed schemas, role passwords,
  provider infrastructure and deployment/environment recovery are not covered.
  Role flags/memberships and default/schema ACL metadata were recorded separately.
- No Supabase Storage objects, user profile image references or staff-document
  image references were found during inventory. Bundled fonts/logos and matching
  deployed application/environment artifacts still require release preservation.
- Earlier IDs `c5f075db2a30` and `4606fa636d81` are incomplete/failed verification
  attempts. They must not be presented as verified backups.

### Restore evidence

Restored into a new PostgreSQL 17.11 instance with memory-backed PGDATA, a private
internal Docker network and no reachable host port. No application, mail sender,
worker or production environment was loaded. Source ownership/ACL remain in the
archive; the isolated copy uses local postgres ownership and omits source grants.
Production grant/runtime-role equivalence is therefore still a separate gate.

All **104 tables** (103 application tables plus migration history) matched source
per-tenant row counts, identity fingerprints and full-content fingerprints.
Financial aggregates, columns, indexes, enums, policies, RLS flags and application
function definitions matched. **Zero foreign-key orphans** were found by the
local release checker. No release migration has been applied to the restored
client copy.

Two CHECK expressions were regrouped by `pg_restore`'s SQL parser:
`CrmFollowUpRule_limits_check` and `CustomFieldOption_valid`. The exact observed
before/after expressions were reviewed as associative AND regroupings of the same
pure predicates and recorded in private evidence. Constraint objects were compared
in stable order because catalog ordering differs by database collation. No generic
parenthesis stripping or release-checksum exception was added.

The original source uses ICU locale configuration (`en_US.UTF-8` collation/ctype);
the temporary Alpine database has different default sorting. Fingerprints now use
explicit `C` ordering. Locale-sensitive runtime behavior is **not yet certified**;
match the source locale for full runtime/performance rehearsal.

After removing the first restored instance, the same encrypted artifact was
decrypted and restored again into a fresh instance. Verification passed again:
`9d534e25f642-run-1792312450051-restore-result.json`, with the full local capture
in the corresponding `-before.json`. This proves repeatability of the protected
artifact, not application cutover readiness.

One-off helpers are retained locally in `tmp/r5-backup.cjs`,
`tmp/r5-restore-internal.cjs`, `tmp/r5-verify-restored.cjs`, `tmp/r5-replay.cjs`
and `tmp/r5-schema-compare.cjs`. Use the internal-network restore helper for a
fresh local restore; its original host-port predecessor is not the verified path.
The helper refuses a nonempty restore destination and writes a new evidence set
on each run. Do not expose protected artifacts in Git or public issues.

### Historical replay and remaining gates

All **97 baseline migrations replayed successfully** in a separate empty database.
Schema comparison against the restored client found the same two CHECK-expression
regroupings and the expected extension-location difference: a fresh PostgreSQL
replay installs pgcrypto into `public`, while Supabase already has pgcrypto in
`extensions`. No other differences were found in the compared table/column/index,
enum, policy, RLS and application-function metadata. This comparison does not
cover every PostgreSQL object, grant, provider service or runtime behavior.

The **12 original checksum mismatches remain unresolved**. Successful schema replay
does not establish which SQL bytes were originally applied; migration history and
the reviewed manifest were not edited. Deployment remains blocked pending that
reconciliation and the remaining release gates.

The verifier was corrected to handle non-null unique row keys and stable sorting
(snapshot format 2). Five unit/integration tests passed with no skips, including
token replacement detection, raw-token exclusion, deterministic identity order,
unsafe-key rejection and old-format rejection. Targeted lint, source-manifest
verification and whitespace checks passed. No UI change; no build/browser rerun
was needed for this tooling correction.

Next: resolve historical checksum provenance, verify Vercel deployment identity,
complete recovery/environment coverage, then rehearse release migrations and
runtime permission/workflow/performance gates. Nothing committed, pushed or
deployed; live client records were not changed.

## 2026-10-18: database confirmed; historical checksum differences found

The owner confirmed `tehtbbifiimoplzlewzs` as the Supabase project used by
`erp.ewissen.in`. Read-only inventory used only `.env.new-vercel`'s session-pooler
connection, with an exact project/host/port guard. Neither environment file nor
the local Vercel link was changed.

The initial TLS connection failed with `SELF_SIGNED_CERT_IN_CHAIN`, including
when using the Windows trust store. Downloaded the public production CA from
the URL published in Supabase's official Studio source:

- [Certificate URL configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json)
- [Supabase SSL verification documentation](https://supabase.com/docs/guides/platform/ssl-enforcement)

The subsequent connection retained CA and hostname verification. No insecure TLS
fallback was used. The CA expires April 26, 2031; SHA-256 fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

### Confirmed database findings

- PostgreSQL **17.11**, database size **18,994,867 bytes** at inventory time.
  Use PostgreSQL 17 backup/restore tooling; the existing PostgreSQL 16 fixture
  container is not the matching rehearsal server.
- Queries ran in a read-only repeatable-read transaction, with connection-level
  read-only default, 15-second statement and 3-second lock timeouts. The reader
  has RLS bypass, allowing complete inventory; application runtime permission
  tests must still use a separate non-bypass role.
- Two active tenants: the platform tenant and Ewissen Infra. The latter owns
  the `erp.ewissen.in` domain mapping.
- All **103 expected baseline application tables** exist, plus Prisma history.
  No missing or extra public application tables. This is table-name evidence,
  not a complete schema-equivalence or data-integrity result.
- **97 completed baseline migrations**, no missing/unknown/unfinished entries
  or release migrations. **12 historical checksum mismatches remain.**
- No enquiry import batches or import rows. Six open CRM tasks, three with
  undismissed reminders. Those counts do not prove there are no active web
  requests or external workers.
- No objects in Supabase Storage and no user profile image references at the
  time of this snapshot. User document image references still need inventory.
  No `cron.job` relation was present. External integrations remain unverified.
- GitHub `main` still points to `5f1323807141f3785e1a8bd45b39e54cbc727c53`.
  This does not establish which revision is deployed on Vercel.

### Checksum investigation and release blocker

The mismatched migration names are:

```text
20260201095732_fix_shift_schedule_defaults
20260220090000_leave_definitions_phase1
20260220100000_leave_definition_weekoff_holiday_rules
20260220110000_leave_groups_phase1
20260221183000_tenant_foundation_phase1
20260221190000_tenant_scope_services_appointments
20260221195000_tenant_scope_inventory
20260221213000_tenant_scope_taxes
20260221222000_tenant_scope_shifts
20260221231500_tenant_scope_leaves
20260301190000_flexible_week_plans
20260301200000_flexible_recurring_patterns
```

None matched the file revisions available in local Git history, with raw,
LF/CRLF or BOM variants. Current-file trailing-newline variants also did not
match. The cause is unresolved; this is not proof of data corruption. Do not
overwrite migration history, edit historical SQL or relax the manifest gate.
Preserve the original history with the backup, recover the originally applied
SQL where available and compare the restored schema with a baseline replay
before deciding on a reviewed reconciliation approach.

Private metadata evidence is in ignored `tmp/industry-release/`:
`inventory-1792311321746.json` and `checksum-investigation.json`. The directory's
Windows ACL grants access only to the current Windows user and SYSTEM. These
are inventory reports, **not backups**. No customer row contents were exported.

Next: protected PostgreSQL 17 backup/restore preparation, historical migration
and schema reconciliation, remaining asset/integration inventory, and verified
Vercel project/deployment identity. No backup or restore has yet been completed.
No database writes, migration, commit, push or deployment occurred.

## 2026-10-18: inventory started; target confirmation pending

Read-only local configuration and public-domain checks completed. No hosted
database connection, backup, migration, client-data change, commit, push or
deployment was performed during this inventory.

### Verified evidence

- `erp.ewissen.in` and `leiwissen.leigia.com` both resolve by CNAME to
  `7e288af6767fda1a.vercel-dns-017.com`; HTTPS follows to `/auth/signin` with
  HTTP 200 and Vercel response headers. This establishes reachability, not the
  owning project, deployed commit or database identity.
- `ls-erp-phi.vercel.app` follows to `/auth/signin` with HTTP 404. Do not treat
  this historical default hostname as a verified release target.
- The local `.vercel/project.json` still names `ls-salon`. Its link is not
  sufficient evidence of the current Vercel project. No CLI authentication file
  was found in the checked standard local/roaming locations.
- `.env` and `.env.new-vercel` identify different Supabase projects. The latter
  has the expected platform root domain, but that alone does not prove it is
  the current client's database. Credentials were not printed or changed.
- `node scripts/industry-release.cjs verify` passed: 99 migration checksums and
  the Prisma schema match the reviewed manifest. No database connection.
- Environment files and `tmp/industry-release/` are Git-ignored. Ignore rules
  are not encryption or access control; protected backup storage is still needed.
- The local PostgreSQL 16 rehearsal container is stopped. PostgreSQL client
  tools were not found on the host PATH. Match backup/restore tools to the
  verified source server version before exporting data.

### Backup coverage identified in current source

- Import headers/configuration and individual row values/status/errors are in
  `CrmEnquiryImport` and `CrmEnquiryImportRow`.
- Saved quotation revisions are JSON snapshots in `CrmQuotationRevision`.
  PDFs are generated from snapshots and the repository's bundled font; quotation
  logos are embedded data URLs. Preserve the matching application assets too.
- User images and user document images can contain external URLs. Inventory
  actual providers and preservation requirements on the verified target; a
  database backup preserves URLs, not externally hosted file contents.
- SMTP sends exist for invitations, password recovery, leave notifications and
  invoices. Disable delivery on the rehearsal copy before starting the app.
- Current `vercel.json` specifies region `bom1` and no cron entries. This does
  not rule out jobs or integrations configured outside this repository.

### Required next evidence

1. Confirm the Supabase project reference with the owner, and match it to the
   actual Vercel production database configuration. The confirmation request
   names the reference found in `.env.new-vercel`; do not share passwords.
2. Obtain authenticated deployment/project identity and the deployed Git revision.
3. On the verified database, use bounded read-only queries for migration history,
   tenant identity, schema/table sizes, import/reminder states and integrations.
4. Establish protected backup storage, retention and complete asset coverage;
   then perform the isolated restore and the release checks described in
   [the release runbook](INDUSTRY_NEUTRAL_RELEASE.md).

At this initial checkpoint R5 was incomplete. Do not connect to either candidate database merely because
its credentials are available, relink the Vercel project, or begin cutover based
on this partial inventory.
