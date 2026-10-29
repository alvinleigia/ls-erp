# Payment receipt documents - P10

Deployed and verified on staging on 2026-10-30 from `22e3237`.
Deployment `dpl_Fe9GrZWRDgF3aRurFdb77BCcqGgr` is READY on all four staging
aliases. Production aliases and GitHub main remain at `4546cb2`. Migration 137
was applied only to staging; no environment update, Git push or production write.

## Usage

1. In Settings > Company document templates, select the issuing company and
   **Payment receipt**. Review the wording, address, signatory, logo and PDF
   layout; sample previews use example facts. Enable issuance and publish a
   reviewed version. Actual Tenant Admin authority is required to publish.
2. Open a confirmed Sales Order with opened receivables. Record an externally
   received payment using the existing payment workflow; partial payments are
   supported. This feature does not collect money or create a second payment.
3. In Payment history, open **Receipt documents** for that payment. Prepare a
   document, download its draft, review it, then confirm issuance.
4. Later downloads reuse the exact archived PDF. Corrected wording requires a
   linked replacement and a reason; earlier versions remain available.

Numbers use `RCT/000001/V1`: the base number is tenant-scoped and shared across
its operating companies, and the suffix is the immutable document version.
Replacements retain the base number. Previews do not consume numbers. Another
payment's issuance can invalidate a prospective number; refresh and review the
prepared preview rather than silently issuing a differently numbered document.

Corrections and full refunds remain the existing financial actions. A reversed
payment cannot issue new receipts. Its UI identifies original PDFs as historical
and warns that they do not confirm a current payment. Direct original downloads
require explicit reversal acknowledgement. The original file is never rewritten
or silently watermarked; its protected payment section explains that later
refunds/corrections require checking current status.

## Reuse and boundaries

- The shared editor, company/type publication, prepare/review/issue engine,
  idempotent upload/commit handling, private PDF storage and source controls are
  reused. Existing order and Real Estate letters use the extracted controls too.
- Receivables owns this provider and its posted-payment rules. It imports no
  industry extension. Accepted customer participants and saved reference context
  come from the order snapshot, including source-supplied property labels where
  present. They do not establish payer identity or property ownership. Other
  payment sources need their own explicit adapter; invoices retain their own
  accounting/tax rules and are not introduced by this feature.
- Protected sections retain every accepted customer, recorded amount, payment
  date/method/transaction reference, allocations and saved order references.
  Internal payment notes and recording-user details are not copied to the
  customer-facing PDF. No current contact/catalogue query reconstructs accepted
  facts, and no balance or financial posting is changed by receipt generation.
- `paymentDocuments` has independent Read/Create/Export actions under Receivables.
  Existing profiles and user rules gain no grants automatically. Tenant Admin
  retains its existing account authority. Delegate permissions and supported
  record limits explicitly through the shared access UI when needed.
- Every operation also requires current Sales Orders/Receivables activation and
  parent Sales Order, Receivable and Payment Read. Own/managed-team/all limits,
  office RLS, selected sharing and Restricted ancestry remain mandatory. Create
  intersects Export before preparation and again before commit; a new grant
  cannot bypass a missing parent scope or current source privacy.
- New issuance requires a currently posted payment, confirmed referenced order,
  active saved issuing office/company and the latest enabled reviewed template.
  Reversal shares the order lock. Facts, permissions, source versions, template
  and prospective number are rechecked after rendering before archival commit.
- The additive migration creates `OrderReceiptDocument` and a private
  `ReceiptDocumentSequence`; it does not alter old rows, profiles, payments,
  allocations, source policies or functions. Native tenant/source RLS, immutable
  triggers, foreign keys, source/payment evidence checks, replacement constraints
  and transactional numbering protect the new records. Audit failure rolls back
  the receipt and number, and removes the unused uploaded object.
- Recovery inventories include every receipt PDF and retained logo reference.
  Runtime sample/draft previews use no storage; a PDF object is kept only after
  issuance. Existing 10 MB PDF/512 KiB payload/100-page bounds and short-lived
  signed downloads remain in force.

## Verification

The migration rehearsal forced a rollback and proved exact preservation of all
137 preceding tables, policies and functions, with no access/profile backfill.
The initial 57-case native suite passed 56 cases; a missing probability in the
new hidden-office fixture was corrected without changing application validation.
All 14 focused receipt/storage/resource cases then passed, including the nine
new receipt cases. Five storage/recovery checks passed after adding receipt
references. Four final browser cases passed, including three existing document
regressions and the new partial-payment/issuance/refund/historical-download flow.

Build/TypeScript, targeted lint, whitespace and all four font faces traced to
receipt preview/issuance passed. Generated receipt pages and readable
desktop/mobile payment-card captures were inspected. The owned disposable local
database container was removed after verification.

The staging operator preflight verified the expected project and 136 existing
migrations, allowing only equivalent LF/CRLF checksums. It created an encrypted,
private application-schema backup, verified decryption/checksum and custom archive
readability, and applied the additive migration transactionally. Existing rows
in all 137 prior tables, prior policies and prior functions remained unchanged.
The backup archive was not subjected to a full restore rehearsal in this phase;
the migration's rollback/preservation rehearsal ran on the disposable database.

Hosted QA used ordinary APIs/UI and bundled Chromium with normal HTTP transport,
without hosted fixture/seed/reset SQL or network mocks. Template samples did not
publish, draft previews did not issue, and a real private-storage PDF was issued
for a partial payment without changing ledger balances/version. A refund through
the UI blocked new issuance and silent original downloads; an acknowledged
historical download returned the identical PDF checksum. Cross-tenant access,
malformed inputs and cross-origin writes were denied, with no page errors or
mobile overflow. Internal payment notes were absent from the actual issued PDF.

One initial hosted attempt began before alias promotion finished and reached the
old provider registration. Its clearly named synthetic payment was corrected and
its order cancelled through ordinary APIs, before restarting after readiness.
The final run retained one refunded QA payment and one historical PDF; its QA
receipt template was disabled in a new published version after verification.
No pilot/production business record was used or changed.
