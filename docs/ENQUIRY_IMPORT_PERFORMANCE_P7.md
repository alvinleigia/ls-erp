# Enquiry import performance - P7

Implemented on the local `staging` branch. Hosted staging deployment requires
renewed Vercel CLI access. Production remains unchanged. This change needs no
database migration and does not rewrite existing imports or customer records.

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

Repeat the isolated native suite with `npm.cmd run test:crm:team-intake`.
After `npm.cmd run build`, add `--browser` to the underlying runner for the
browser checks: `node scripts/test-sales-orders.cjs --teams --browser`.
Never point fixture/reset scripts at a hosted database. Local run evidence is
kept under ignored `tmp/industry-release` and `test-results/local-access`.
