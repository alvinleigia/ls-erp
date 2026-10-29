# Enquiry import performance - P7

Deployed and verified on [staging](https://ls-erp-staging.vercel.app) on
2026-10-29 (Asia/Kolkata), including the history fix from clean checkout `5a5deee`.
Deployment: `dpl_BrAcTYddsnhXGDkaZnZVdR8EUygw` (READY).
The initial batching release and measured comparison below used `2cd77e1`.
Production was subsequently released from `4546cb2` on the same date after
the user authorized release. Its application code matches the staging build;
the intervening commit only records verification. See the release checks below.

This change needs no database migration and does not rewrite existing imports
or customer records. The earlier staging release used the CLI; production used
one Git push to `main` and its normal Vercel build.

## Production release - 2026-10-29

Source `4546cb296407147964334a4d07d4020444a5c63d` is on GitHub `main` and
deployment `dpl_EkQhmuCQqrwuxoRgR5vMMDx9kuFG` is READY. All three production
aliases serve it. The four staging aliases still serve the verified staging
deployment above. The root checkout remains linked to the production project.

Before release, a fresh encrypted application backup was restored into an
isolated local database: 138 tables, 136 applied migrations, owner/ACL and role
metadata, and two referenced storage objects verified. There were no pending
migrations. This is application recovery evidence, not full Supabase platform
recovery certification. Private archives and restore evidence remain ignored
under `backups/participants`; no credentials or client records are committed.
The previous READY production deployment is retained for code rollback.

Read-only checks using the existing tenant session passed after deployment:
dashboard, modules, workspace office, enquiries, opportunities, projects and
quotations returned HTTP 200; the tenant-admin platform tenant-list request
remained denied with HTTP 403. Three import-history requests returned HTTP 200
in 4,226 ms, 2,586 ms and 2,451 ms. The history page reported three retained jobs
and 2,497 rows, matching the preflight aggregate. Template download succeeded.
The browser rendered import history without an error banner and the dashboard
without page errors or horizontal overflow; heading-only captures were inspected
to avoid recording client rows. Production testing did not upload/import data.

No maintenance block, migration, configuration change or business-data rewrite
was required. Refresh existing ERP tabs to load the new import interface.
Private deployment and smoke receipts are under ignored
`tmp/import-performance/production-release`.

## History-refresh fix verified

History now loads the authorized parent page without correlated relation counts,
then groups child-row counts once for only the selected import IDs and tenant.
The same transaction, fresh authorization, creator restriction, native office
RLS, pagination order and response fields remain in place. Empty results skip
the child query, and parents without children retain a zero row count. Counts
still include invalid/duplicate input rows. No counter cache, schema migration,
data backfill, security exception or increased timeout was introduced.

The original failing QA tenant retained seven imports and 2,116 staged rows,
including both completed 1,000-row benchmark imports. Three consecutive hosted
history requests returned HTTP 200 in **3,626 ms, 3,525 ms and 3,392 ms**. The old
endpoint returned HTTP 500 after approximately 27 seconds at this retained volume.
Pagination, a wider page, an empty page and both 1,000-row counts were verified.

A fresh browser import completed without pausing or a history error: 61 input
rows, 59 imported, one invalid email and one duplicate, with the expected two-row
correction file. All five automatic history refreshes returned HTTP 200. Returning
to Your imports showed the correct completed entry. Every existing history entry
and its count was unchanged. Desktop/mobile history captures were visually
inspected; another tenant could not retrieve the new import.

Validation passed: 33 native import/team checks, 26 native office checks, two
local browser checks, production build/TypeScript, targeted ESLint and whitespace
checks. Added regressions cover multiple 1,000-row jobs, mixed and empty jobs,
pagination, creator/tenant privacy, suspended accounts and office revocation.
An initial office run used incompatible general fixtures, and concurrent fixture
creation interrupted an initial long import on a serialization safeguard. The
final dedicated office run and standalone import run passed; no application
guard or timeout was weakened. The hosted test's initial broad alert selector
was corrected to exclude Next.js's empty route-announcement element.

At the staging checkpoint, all four staging aliases were on the fix and
production was unchanged. Private
query probes, test logs, hosted timings and captures are under ignored
`tmp/import-performance/history-fix`.

## Measured hosted comparison - 2026-10-29

A sequential comparison used the previous staging deployment (`ae3e491`) and
the P7 deployment (`2cd77e1`). Each received 1,000 unique, valid synthetic rows
using the same template, tenant, account, creation office, mappings, database and
Mumbai function region. The CSV payloads were both 220,339 bytes. Each version
first completed a separate 25-row warm-up. Critical environment settings were
unchanged since the baseline build.

| Row-processing measure | Previous version | P7 |
| --- | ---: | ---: |
| Validation | 17m 24s | 4m 45s |
| Saving | 18m 39s | 6m 36s |
| Combined processing | 36m 03s | 11m 20s |
| Processing POSTs | 400 | 80 |
| Save-progress JSON bodies | 2,112,168 bytes | 3,702 bytes |

P7 used **68.5% less row-processing time**, 80% fewer processing requests and
99.8% fewer save-progress JSON bytes in this comparison. Both versions imported
all 1,000 rows without validation errors or duplicates. Times are independently
rounded and exclude upload, mapping, human review, final detail reads and import
history refreshes for both versions. JSON sizes are decoded response-body sizes,
not compressed network traffic. This is one sequential staging comparison,
not a production timing guarantee.

**Issue found during the benchmark (resolved above):** once multiple large imports accumulated, the history
endpoint (`GET /api/crm/enquiry-imports`) returned HTTP 500. Runtime logs confirmed
an expired 20-second transaction; a repeat request also failed. The history
implementation is unchanged between the baseline and P7. It counts child rows
for each listed import and needs optimization at this larger retained volume.
Do not treat the successful row-processing measurement as an uninterrupted
end-to-end pass: P7 completed validation, then its history refresh failed, and
the existing ready job was resumed through the normal API to measure saving.
All 1,000 rows were subsequently confirmed imported. The final history refresh
still returned 500 after approximately 27 seconds.

The grouped-count fix above resolves this issue while retaining its privacy
rules and transaction limit. No application code, database
schema, permissions, module settings or production data changed during this
measurement. Only the dedicated QA-A alias temporarily served the baseline;
it was restored to P7, and all four staging plus three production aliases were
verified afterward. Private measurement samples and diagnostics are under
ignored `tmp/import-performance/benchmark-1000`.

## Processing contract

- Validation and import attempt up to 25 rows per request instead of five.
  A cooperative 15-second budget stops the next row from starting after the
  deadline. One row is always attempted; an in-flight row finishes normally.
  The route still has a 60-second duration and existing transaction limits and
  serialization retries are unchanged. This is not a hard per-row deadline.
- Each row remains its own transaction through the same enquiry creation path.
  Current membership, module, permission, office, assignment, custom-field and
  industry rules remain enforced. A failed save leaves no orphan contact.
- Choice names, IDs and aliases are normalized once per request, with ambiguous
  matches and parent-dependent choices retaining their previous meaning.
  This catalogue is not an authorization cache; domain writes revalidate.
- Duplicate email/phone checks run during validation and again during import.
  Existing contacts remain unchanged, and prior file rows retain precedence.
  Rows stay sequential; no concurrent row writes or bulk creation were added.
- Processing POSTs return only `{ id, status, counts }`. Completion detection
  and counts share a transaction, eliminating the separate full-result read
  after every batch. GET remains the paginated detail endpoint.
- The browser updates counters during processing and refreshes details once
  the phase finishes or processing pauses. Detailed tables are not rebuilt on
  every progress update. Reload/resume uses persisted import and row states.
- Correction CSVs still contain only invalid/duplicate rows, preserve original
  input and row numbers, and remain safe to correct and reupload. The existing
  1,000-row, 3 MB file and expanded-workbook limits are unchanged.

With full 25-row batches, 1,000 valid rows need 40 validation and 40 import
requests, compared with 200 of each previously. Slow requests may process fewer
rows. This request reduction is not an equivalent elapsed-time speed guarantee.

## Verification

- TypeScript, targeted ESLint, production build and whitespace checks passed.
- Two Playwright checks passed against the updated production build and a
  disposable local database under the ordinary non-BYPASSRLS application role.
  They cover template download, desktop/mobile mapping, validation without
  creating CRM records, correction download/reupload, interrupted processing,
  reload/resume, compact progress responses and paginated correction results.
- Desktop correction results and mobile mapping captures were visually checked.
- All 32 native import/team checks passed, including forced early checkpoint
  and resume, current access/module rules, atomic rollback and concurrent retries.
- The 1,000-row native import used 40 validation and 40 import requests and
  completed in 266 seconds locally. It imported 995 records, skipped two invalid
  rows and three duplicates (one contact arrived after validation), retained all
  five correction entries and recorded the completion audit exactly once.
  Local elapsed time is not a hosted performance guarantee. An initial run hit
  its 240-second benchmark test timeout; the final benchmark allows 900 seconds,
  without changing any application request/transaction limits.
- Hosted staging acceptance used only an existing synthetic QA tenant through
  the normal browser and HTTP APIs. A fresh 61-row import used three validation
  and three import requests: 59 imported, one invalid email and one duplicate.
  Compact response bodies, saved reload, both correction rows/download and
  foreign-tenant denial passed. Desktop/mobile captures were visually checked.
  The complete check took 57 seconds, including browser work and screenshots;
  this is not an isolated server-throughput measurement.
- All four staging aliases resolve to the new deployment. Production's existing
  deployment and all three aliases are unchanged. No hosted fixture/seed/reset
  script or production business mutation was used.

Repeat the isolated native suite with `npm.cmd run test:crm:team-intake`.
After `npm.cmd run build`, add `--browser` to the underlying runner for the
browser checks: `node scripts/test-sales-orders.cjs --teams --browser`.
Never point fixture/reset scripts at a hosted database. Local run evidence is
kept under ignored `tmp/industry-release` and `test-results/local-access`.
