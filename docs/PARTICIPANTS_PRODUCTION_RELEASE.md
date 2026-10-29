# Participant/document production release - P6C

Completed on 2026-10-29 after the user's explicit instruction to start the
production maintenance window, take fresh verified recovery artifacts, apply the
four migrations, push the tested release to main and verify before reopening.
Production is open. The access barrier lasted **10 minutes 30 seconds**;
final audit passed at **05:28:51 UTC / 10:58:51 Asia/Kolkata**.

## Released source and targets

- GitHub `main`: `579d64293d5b718d73f1febfa26876b3d8bfba0d`, pushed by fast-forward.
  Its application files match the P6B-tested `ae3e491` exactly; the later commits
  add release documentation. No application fix or compatibility override was
  introduced during cutover.
- Production project: `ls-erp`, `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`.
- Production deployment: `dpl_HtxFZNRYpzs6ZZp6DtLohq67HUKy`, READY for that exact
  commit. The existing Git integration built it once after the approved push;
  no duplicate manual deployment was created.
- Verified domains: `erp.ewissen.in`, `leiwissen.leigia.com`,
  `ls-erp-phi.vercel.app`. All point to the new production deployment.
- Production Supabase: `tehtbbifiimoplzlewzs`. Final history is **136 applied
  migrations in 137 attempts**, zero pending, with the one original rolled-back
  attempt retained exactly. No checksum/history repair or `migrate resolve`.
- Staging's four verified aliases remain on `dpl_6z6K6LfBXVJvZ4PxsC4PteUyfVic`.
  Its application and 136-migration schema match this release; environment and
  business data remain separate. Remote `staging` was not pushed in this operation.

The four SQL changes add opportunity participants, correspondence requirements
and acceptance, order references/dates, and versioned company document issuance.
See [the runbook](PARTICIPANTS_PRODUCTION_CUTOVER.md) for their exact names and
the reviewed source boundary.

## Final recovery and live preservation

The production runtime identity, OID, login flag and connection limit were captured
before the barrier. Other privileged writers, active privileged cron and prepared
transactions were checked. Runtime sessions were drained, and a fresh connection
to the actual transaction pooler was proved unable to log in. Tenant/user statuses,
business profiles and grants were not changed to establish maintenance.

Final protected recovery set: `backups/participants/223c4a18f953/`, ignored by Git.
It contains the consistent encrypted application database, password-free role and
source/environment inventories, both stored logos and both saved references.
Plaintext database archives were streamed in memory; AES-GCM keys use Windows
CurrentUser DPAPI, in the project as previously requested.

An independent isolated restore verified all 133 original tables including
history, owners/ACLs, role attributes/memberships and saved file bytes/references.
The same final snapshot then upgraded 132 to 136 migrations with the six actual
managed DDL trigger definitions under the reviewed non-superuser operator.
Only the isolated copy's runtime login settings were temporarily restored for
ordinary-role probes; its captured flags were restored afterward. Production
remained frozen throughout this rehearsal.

All **seven accounts**, **161 resource/action checks** and **1,235 record/action
bindings** matched before/after the copied upgrade. Foreign-tenant reads remained
denied. PostgreSQL versions match at 17.11; the documented ICU-version difference
and incomplete reproduction of managed Supabase services retain P6A's limits.
P6B provides separate real hosted-service workflow acceptance.

Live frozen fingerprints matched the final backup before `prisma migrate deploy`.
The encrypted original-row capture and repeated reconciliation verified:

- All original values/IDs in **132 application tables**, all **133 original
  migration attempts**, profiles/rules, assignments, sharing, offices, modules,
  snapshots and financial rows retained their values.
- Five new tables remained empty before reopening. Existing correspondence,
  acceptance, references and dates remained unrecorded; no customer, property or
  historical document facts were invented.
- Original security metadata remained exact: **two schemas, 664 relations,
  165 functions, seven default ACL entries, 98 triggers and 358 RLS policies**.
  Global roles, memberships and settings remained exact through migration.
- The captured runtime role/OID, login flag and connection limit were restored
  only after READY, all aliases, history and reconciliation had passed.

These are pre-reopening preservation results. Normal later authentication may
update login metadata, and clients may resume ordinary work. They are not a claim
that the live database must remain byte-identical after reopening.

## Live acceptance

- Actual non-BYPASSRLS runtime sessions matched the final rehearsal across all
  **seven accounts, 161 action decisions and 1,235 record/action bindings**.
  Native deliberate foreign-tenant enquiries/orders remained invisible.
- The existing pilot session passed **eight read-only checks** covering modules,
  workspace, dashboard, enquiries, opportunities, projects, quotations and denied
  tenant provisioning.
- **Five feature reads** verified customer-detail defaults, issuing-company
  template catalog/defaults and sales-order activation. Customer requirements
  remain unpublished with no new mandatory fields; the company template is
  unpublished and disabled. No configuration was published by the tests.
- Fresh platform-admin credential login passed, followed by **three read checks**:
  tenants/organizations allowed and CRM business access denied. This used the
  ordinary login flow, including its normal login metadata update.
- Separate Chrome contexts rendered the authenticated Dashboard and Company
  document templates page without page errors or body overflow. Only their
  headings were captured and visually inspected; client rows were excluded.
- Final history, every original history row, role/OID, global grants and original
  security metadata matched. Both original stored objects downloaded with exact
  byte lengths/SHA-256 hashes; both saved references and bucket privacy match.

The additional live probe initially stopped because Prisma requires PostgreSQL
`name` values to be cast to text. Its next attempt correctly refused to proceed
without read-only mode: transaction pooling did not retain a startup session
default. The private probe now explicitly sets READ ONLY inside each transaction
and verifies the actual role/mode before its source queries. The full comparison
then passed. No application access predicate or runtime guard was weakened;
failed diagnostics remain encrypted with the final backup.

This is bounded read-only production acceptance, supported by P6B's broader
synthetic applicant/booking/issuance/replacement/security flows and real PDF
Storage checks. No QA tenant, customer, quotation, booking, receipt or issued
document was created in production for testing.

## Operational state and evidence

Private authorization, cutover state, restoration/upgrade/access/smoke receipts,
final audit and actual utility hashes are under `tmp/participants/p6c-evidence/`
and the final protected backup folder. Owned rehearsal containers and internal
networks were removed; unrelated containers were untouched.

The release does not publish legal wording, activate modules or expand saved staff
profiles. A tenant administrator reviews and publishes company templates and any
required-field definition; ordinary module/profile controls still apply. KYC
uploads, electronic signatures and ownership calculations remain outside scope.

Post-release documentation is committed locally to avoid another production
build. The released application remains `579d642` on GitHub `main` and Vercel.
Restoring the pre-cutover backup after clients resume can discard new work and
requires an explicit recovery/data-loss decision. Retain the matched recovery
set and follow the reviewed ownership/ACL-preserving procedure; application
rollback alone does not reverse the schema transition.
