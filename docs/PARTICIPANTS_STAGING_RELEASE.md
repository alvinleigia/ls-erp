# Participant and document release - P6B staging

Completed on 2026-10-29 (Asia/Kolkata). P1-P5 are deployed and verified on
[staging](https://ls-erp-staging.vercel.app). Production remains on its earlier
R10 release. No production migration, deployment or Git push occurred.

## Released source and database

| Target | Application commit | Applied migrations |
| --- | --- | --- |
| Staging `ls-erp-staging` | `ae3e49115da1ef0cef472684a0a675b26f42a4b7` | 136; zero pending |
| Production `ls-erp` | `f9e24db1812e069845d248b345b50b48fcd2e32e` | 132; four pending |

Staging deployment `dpl_6z6K6LfBXVJvZ4PxsC4PteUyfVic` was built from a clean,
detached checkout of the candidate. Its source metadata, project identity and
READY state were verified. The stable staging domain and the two dedicated QA
domains resolve to it. Production deployment `dpl_5an58aZq3r8VUYi785v6WV7ddYK1`
and all three production aliases remain unchanged.

The CLI candidate was built before migration and withheld from the stable staging
aliases. An extra generated alias assigned by the CLI was returned to the old
deployment until cutover. Only the staging project's deployment was promoted.
The root checkout's project linkage was not changed. Application code required
no correction after the verified P5 build.

## Recovery and preservation

All connection targets were pinned to their distinct Supabase project references.
Credentials and file contents were kept out of public output. Production was
used only for read-only deployment/history verification.

The refreshed staging rehearsal backup is
`backups/participants-staging/d82ba1592c48/`. Its isolated native restore upgraded
132 to 136 migrations with the real managed DDL trigger definitions. All **199
existing accounts** matched across **4,577 resource/action checks** and **1,932
account/record/action bindings**. Foreign-tenant enquiry/order probes remained
denied under the ordinary non-BYPASSRLS runtime role. Existing storage references,
owners, ACLs and global role attributes remained unchanged.

Early copy-only attempts stopped on overly large read-only probe transactions.
The one-off probe driver was split into smaller operations. Native restore
planner statistics were rebuilt on the isolated copy; no runtime access predicate
or application timeout was relaxed. The refreshed full rehearsal passed. The
owned copy containers and their internal networks were removed afterward.

For cutover, the staging runtime role was temporarily blocked and existing
runtime sessions were drained. The final encrypted backup,
`backups/participants-staging/0bfa7f198612/`, was independently restored before
hosted migration. It retained all 133 original tables including migration history,
all 12 stored files and all nine saved asset references. Its source evidence
matched the rehearsed snapshot before migration.

Hosted `prisma migrate deploy` applied exactly the four reviewed migrations.
Before reopening, verification confirmed:

- All original values/IDs in 132 application tables and all 132 original
  migration attempts were retained. Existing profiles, rules, assignments,
  snapshots and financial rows matched exactly.
- The five new tables were empty. Existing correspondence, acceptance,
  reference and order-date fields remained unrecorded; no historical customer,
  property, date or document evidence was invented.
- Original security metadata matched: two schemas, 664 relations, 165 functions,
  seven default ACL entries, 98 triggers and all 358 original RLS policies.
- The runtime role's original identity, login flag and connection limit were
  restored. Runtime connection and non-BYPASSRLS checks passed.

These are pre-test preservation results. Subsequent authorized QA API activity
created labeled synthetic records and ordinary audit/version changes. It was not
an attempt to keep the staging database byte-identical after testing.

The encrypted recovery artifacts use AES-GCM and Windows CurrentUser DPAPI, in
the project as previously requested. This is local application/schema/role/file
recovery, not an off-device backup or a complete Supabase platform reconstruction.
The rehearsed ICU versions still differ as recorded in P6A; hosted acceptance
below supplies the separate real-service evidence.

## Hosted acceptance

Testing used the existing two isolated QA tenants through ordinary application
APIs and separate Chrome contexts. No fixture, seed, reset, copied pilot login
or direct SQL business write was used against the hosted application.

The resumable driver recorded **160 successful HTTP status assertions**, plus
PDF byte/hash and browser assertions. These are request checks, not 160 distinct
end-to-end scenarios. Three driver expectations were corrected to the existing
API contracts: contact edits require the archive flag; user creation returns a
wrapped user with HTTP 200; an explicitly denied Export action returns 403.
The successful synthetic user response was retained rather than creating a
duplicate. Checks resumed against the same labeled records.

Verified flows include:

- Three stable person participants, independent correspondence validation,
  email normalization, stale-version rejection and unchanged contact-master
  correspondence. Changing the customer master later leaves accepted evidence
  and issued PDFs unchanged.
- Published required fields reject an incomplete frozen order. Correcting the
  source, saving a quotation revision and replacing the draft permits confirmation
  with the accepted participant proof.
- Generic acknowledgement issuance works with Real Estate disabled. A company
  must publish reviewed wording first. Draft preview stores no issued history;
  changed template versions invalidate an earlier prepared preview.
- Concurrent identical issue requests resolve to one document. Reusing their
  key with changed data is rejected. Explicit replacement links retain both
  original and replacement PDF versions, with exact repeated-download hashes.
- Two-unit Real Estate booking intimation requires current holds; allotment
  requires allocation. Unopened receivables are explicitly unverified. Posting
  a receipt invalidates an earlier financial preview. The issued allotment
  shows the recorded INR 300 total, INR 100 received and INR 200 outstanding.
- A new limited profile can read, issue and download the generic document
  without contact, company-directory or template-configuration access. Missing
  finance permissions hide/deny allotment. Cross-tenant IDs, denied Export,
  disabled Real Estate and current profile revocation remain enforced.
- Actual private Supabase Storage redirects and PDF downloads were exercised;
  no local Storage substitute was used in these hosted checks.

Five desktop/mobile captures were inspected, including the limited issuer,
document history, prepared mobile replacement and the published company template.
The tested pages had no browser JavaScript errors or viewport overflow. All ten
pages of five PDF specimens were rendered and inspected: generic original and
replacement, booking intimation, allotment and unopened-ledger draft. Text checks
also verified applicants, both units/areas, balances and the unverified-state
wording. KYC files, electronic signatures and ownership calculations remain
outside this release.

The new synthetic issuer was suspended and its profile assignments removed.
Original QA module flag values, customer-detail definition and creation-office
selection were restored and independently read back. Their ordinary version and
audit history is retained. Clearly labeled synthetic orders/documents/company
records remain available for review; immutable issuance history was not deleted.

## Evidence and next gate

Private evidence is under `tmp/participants/p6b-evidence/receipt.json`, including
deployment/history checks, preservation/security results, artifact/tool hashes,
PDF inspection and the QA settings read-back. The encrypted backup folders retain
their restore and upgrade receipts. Credentials, sessions, business rows and
operator utilities remain ignored and uncommitted.

This completes the P6B staging gate for these participant/booking/document flows;
it is not a new exhaustive test of every existing ERP module or future workflow.
[P6A](PARTICIPANTS_P6_REHEARSAL.md) retains the separate real-pilot copy rehearsal.
**P6C remains:** a separately authorized production maintenance window, fresh
verified production recovery artifacts, migration/deployment reconciliation and
access verification before reopening. Staging approval does not publish a
production company's wording or expand its saved staff profiles.
