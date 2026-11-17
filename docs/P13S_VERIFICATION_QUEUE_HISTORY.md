# P13S — verification review queue and revision history

Development increment, 2026-11-17. Client configuration remains separate.
No migration, module activation, requirement publication, profile assignment or
transaction-checkpoint change accompanies these views.

## Review queue

Contacts → Verification review opens `/crm/verification`. Internal users need
Customer Verification Read, private submission Read, independent review Read and
private evidence Read. CRM and Customer Verification must both be active. A
manager account role alone grants nothing, and external logins are excluded.

The queue lists the latest undecided submission **per customer and participant
role**, oldest first with an ID tie-breaker. Superseded revisions, decided
submissions and archived customers are excluded. Search is a literal customer
name match; person/business and participant-role filters are optional. It does
not poll in the background. Filters and pages use the shared list-navigation
state so returning from a review preserves the list.

Tenant RLS and native customer visibility apply before counts and pagination;
the bounded page is also resolved through canonical CRM Read scopes. The SQL
adapter lives in the application layer, with review authorization in the shared
verification service. No client-supplied tenant, scope or permission is accepted.
Names, revision identifiers, role, submission date and policy currency are the
only list data. Private facts, reasons, original file names and storage paths
are not included in the queue response.

Review submission opens the exact source-bound revision. Its own frozen policy
labels, facts and evidence are used, even if a later revision exists for another
participant role. The existing review service checks the current global case
version, per-role latest revision and latest decision under the tenant lock.
Self-approval, stale policy approval and superseded-role approval remain blocked.
Approval/Request corrections still require the separate action capability;
revocation needs Cancel and a reason. No bulk approvals or new write path.

## Complete revision history

Customer/account → Verification → Details & review → Revision history loads a
bounded page on demand. Pages show newest revisions first, with 5/10/20/30 rows.
Earlier revisions are accessible beyond the former latest-ten display. Selecting
a revision loads its immutable facts, original requirement labels, selected
evidence and retained decisions. Browsing history does not alter the collector's
open submission draft, customer data or approval status.

Historical inspection is read-only. Evidence download remains independently
authorized, and source access is rechecked both on revision read and on download.
Unavailable/private evidence is identified without disclosing paths or creating
a signed link. Data is fetched afresh with no-store and cancelled on navigation.
Counts and stale pages are resolved on the server.

## Validation and release state

Local tests cover strict/bounded queries, navigation/module grants, more than ten
revisions, role-specific review, hidden-source totals, pagination, immutable facts,
cross-customer/cross-tenant denial, external-user denial, module revocation,
Restricted/Own scopes and independent evidence-download permissions. Browser
flows also exercise queue review, empty search, historical inspection and compact
desktop/mobile layouts, alongside the preceding upload/review/checkpoint/retention/
disposal workflows.

The 181 regression checks passed against a disposable loopback database. The
full historical migration-preservation rehearsal completed through all 157
migrations. Twelve focused access/navigation and query-contract checks passed
(including overlap with the regression suite).

The final isolated production build and all eight real-application browser flows
passed after correcting a mobile overflow caused by the action column's hidden
accessibility label. Desktop/mobile queue and desktop historical-revision
screenshots were inspected. The browser verifies that approval of revision 12
works while revision 13 belongs to another participant role, that history page 2
opens revision 1 read-only, and that browsing preserves all 13 saved revisions.
Prior upload/download, independent correction/approval/revocation, transaction
checkpoints, retention and disposal browser flows passed in the same run.

Evidence is ignored under `tmp/p13s-review-final-tests.log`,
`tmp/industry-release/ls-erp-sales-orders-1dfc69cba0c1.log`,
`tmp/p13s-review-development-build.log`, `tmp/p13s-review-final-browser.log` and
`tmp/industry-release/ls-erp-sales-orders-5155def6cff0.log`. Captures are
`test-results/local-access/verification-queue-desktop.png`,
`verification-queue-mobile.png` and `verification-history-desktop.png`.

Development and local acceptance are complete. Hosted staging acceptance and
deployment are the next release steps. Client activation, requirement publication,
staff assignments and checkpoint configuration remain client setup work.
