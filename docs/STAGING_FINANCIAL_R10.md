# R10 hosted financial acceptance

Phase 6D2 verified on 2026-10-28 against isolated staging QA tenants. **229
financial/API/browser checks passed**, followed by targeted cleanup repair and
**101 independent read-only audit checks**. Counts include HTTP/status and
behavioral assertions, not 229 separate end-to-end scenarios. No application,
schema or deployment change was needed. Production was not modified.

## Target and data

The READY staging deployment remains `dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`, source
`525b8539b968a6858b403e28a48d9de494c5e8b4`. All three staging aliases were checked.
Staging has 132 applied migrations, no pending/rolled-back attempts and a restored
LOGIN runtime role without superuser or BYPASSRLS authority. Production remains
on `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`.

All writes used ordinary authenticated APIs and fresh synthetic IDs in QA tenant
A. Tenant B supplied negative isolation checks. Required modules were already
allowed/enabled in both tenants; no existing module setting, profile or office
grant was changed. A new writer administrator, internal owner, external identity
and read-only finance user were created solely for this run. No hosted SQL
fixtures, seeds or resets were used. Browser sessions and credentials were not
printed, committed or saved into `.playwright-auth`.

Four generic service opportunities/quotations exercised these populations:

| Source | Office | Owner | Original amount | Visibility |
| --- | --- | --- | --- | --- |
| A | Initial | Internal | INR 100.25 | Ordinary |
| B | Initial | External collaborator | INR 200.50 | Ordinary |
| C | Separate branch | Internal administrator | USD 300.75 | Requires branch access |
| D | Initial | Internal administrator | INR 400.00 | Restricted source |

All four recorded the same synthetic introducing collaborator, independently of
the responsible owner. A used two instalments, 40% and 60%. A fifth order tested
replacement after cancellation; it was a separate draft, not a duplicate agreement.

## Documents and agreement lifecycle

- Repeated creation from the same quotation revision returned the same order.
  Draft orders could not open receivables; confirmation succeeded once and stale
  transitions were rejected with 409.
- A preview returned a valid PDF without storing it. Explicit issue created one
  archived PDF; repeated issue returned identical metadata. Downloaded archive
  bytes matched the saved SHA-256 and length.
- Editing A created quotation revision 2 at INR 125.75. Revision 1's snapshot and
  issued archive stayed unchanged; the new revision had no automatically issued
  PDF. A's existing order retained revision 1's INR 100.25 and title.
- A stale quotation save was rejected. A read-only user could not edit the quote
  or cancel the order. An active order blocked creating another order from the
  newer quotation revision.
- After A's payments were resolved, cancellation succeeded. Creating a replacement
  from revision 2 produced a new INR 125.75 order, with idempotent retries.

## Balances, payment recording and history

The INR 100.25 agreement split exactly into INR 40.10 and INR 60.15. Explicit
receivable dates were frozen separately from the quotation's proposed schedule.
Recording INR 30.25 allocated it to the oldest dated instalment: paid INR 30.25,
outstanding INR 70.00 and overdue INR 9.85.

The following were verified through hosted APIs:

- Replaying the same payment request returned the original receipt without a
  duplicate. Reusing its request key with a different amount was rejected.
- Duplicate posted references, stale balance versions and overpayment were
  rejected with 409; future dates and excessive INR precision were rejected
  with 400. Read-only users could neither record nor reverse payments.
- Cancellation with a posted receipt was blocked. A correction restored the
  original balance; retrying that correction returned the same reversal.
- A second INR 20.25 receipt and a recorded full refund restored the balance
  again. Both original receipts and their reversal records remained in history.

These APIs record externally received/refunded money. No payment gateway or
actual money transfer was invoked.

## Isolation, sharing and reporting

The initial-office finance user saw A/B/D before restricting D. Restricting D's
opportunity hid its quotation, order and receivables. An explicit child-order
share did not bypass the source restriction. A source Read share restored
financial visibility; revoking it hid the child again in the existing session.

The same user could not read C's branch order or balance. The second tenant could
not read any of the four quotation, order or receivable details. Removing office
grants cleared current financial rows and denied detail access; restoring the
explicit initial-office grant restored access.

With D restricted, the viewer's rows and numeric summary matched A/B only:
**INR 300.75**. The administrator's summary kept **INR 700.75** and **USD 300.75**
separate. Filtering responsible-account type to External selected B only, with
INR 200.50 outstanding. Partner choices came from readable financial sources.

The quotation dashboard counted two visible documents once each and used their
latest saved values: **INR 326.25**, including A's revision 2. The existing order
and receivable still used revision 1. The matching-record endpoint returned
exactly those two quotation IDs, and the plan dashboard counted A once despite
its two revisions. The sales-report CSV included A/B and excluded C/D.

Removing Opportunity Read kept ordinary finance Read working while denying
origin filters/choices and filtered document drill-downs. Dependent dashboard
document widgets were omitted with an explanation. Removing the remaining
profiles denied financial access immediately in the existing session.

CSV coverage here is the existing sales-report export. Receivables currently has
no CSV export endpoint; this checkpoint does not add one.

## Browser verification

Two Chrome captures were visually inspected: the desktop order/receivable ledger
with correction/refund history, and a 390-pixel mobile receivables view filtered
to the external owner. The mobile count was one, its balance INR 200.50, and the
internal order was absent. No page JavaScript errors or page-body horizontal
overflow occurred. Browser writes were not claimed: financial transitions used
the ordinary APIs, and the browser checks exercised rendering and filters.
PDF verification covered the response/PDF header, saved metadata and byte integrity;
it did not provide a new page-by-page PDF layout review.

## Cleanup and evidence

The main run completed all 229 assertions, then its cleanup used POST for the
opportunity stage-change endpoint, which accepts PATCH. Its original failed exit
and cleanup errors are retained. The corrected targeted utility restored only
the run's archived pipeline/reason temporarily, closed the four synthetic
opportunities through PATCH and rearchived configuration. It did not replay
payments or business assertions. A separate utility removed the synthetic
child-order sharing grant.

An independent read-only audit verified five canceled orders, four closed
opportunities with unchanged saved offices, four archived accounts, three
non-admin accounts without profiles, all four accounts without explicit office
grants/preferences, two reversed receipts and all created configuration/directory
entries archived. No test row appears in active balances. Four quotations and
their immutable revisions remain as QA history, including one issued PDF; these
records were not deleted to make cleanup appear complete. The final completion
receipt links the original assertion run, cleanup repair and audit separately.

Ignored evidence: `tmp/industry-release/phase6d2/MVRJ4XBI/receipt.json`,
`failure.json`, `cleanup-repair.json`, `sharing-cleanup.json`, `cleanup-audit.json`,
`created.json`, the preview PDF and two PNG captures. Utilities/receipt digests
are retained privately with the existing staging recovery checkpoint. No raw
client rows, environment files, authentication state or signed URLs are committed.

## Next gate

Phase 6D3 covers hosted appointments and inventory workflows, followed by Leaves
and Shifts. Invitation acceptance/expiry, multiple managers on one team and
broader sharing/browser-write scenarios remain explicit hosted gates. Production
still needs its own fresh recovery checks and authorized cutover decision.

[Phase 6D3](STAGING_OPERATIONS_R10.md) now verifies hosted appointments and
inventory. Workforce and remaining activation/invitation/browser gates continue.
