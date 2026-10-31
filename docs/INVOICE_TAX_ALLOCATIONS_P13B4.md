# P13B4 frozen invoice tax allocations

Prepared and price-approved tax agreements now use the existing invoice,
payment-application and full-credit workflow. They do not create a second debt,
payment, refund or accounting ledger. Calculation contracts and the summary
control are shared under `platform/tax`; Invoicing owns native balances and access.
There is no Real Estate dependency or tenant-specific tax override.

## Usage

1. Prepare and approve quotation pricing, create the order, confirm it and open
   its receivables through the existing authorized actions.
2. In the order's **Tax-aware invoice allocations** section, create an invoice
   draft for a fixed amount, percentage, milestone, selected quantities or the
   remaining balance. The accepted agreement determines prices and components.
3. Review **Frozen tax allocation** before posting. The net and components sum
   exactly to that invoice's gross; later tax-master edits do not change them.
4. Post using the existing invoice Confirm permission. Posting retains the saved
   draft allocation, including when other drafts are posted in another order.
5. Cancel an unused draft to release its actual reservation. To reverse a posted
   invoice, use **Full credit note**. Its original component allocation is copied
   exactly and released for future billing. The credit can reverse a partial
   invoice; arbitrary partial credits of a single invoice are not introduced.

INV/CN references remain internal billing identities, not statutory registration
or financial-year numbering. These records are not statutory tax invoices or
tax credit notes. Invoice/credit PDF issuance is blocked in both UI/service and
native storage until P13C provides the appropriate statutory lifecycle. A template
cannot turn this allocation into a statutory document. Existing commercial PDFs
and downloads retain their original behavior and exact archived bytes.

## Allocation policy

`REMAINING_BALANCE_V1` uses the actual remaining accepted net and component
balances for each billed line, with net first and then the accepted canonical
component order for equal-remainder ties. Existing active drafts and posted
invoices reserve their actual saved portions. Cancelled/credited rows retain
their history but no longer reserve balances. Independent cumulative rounding
does not recompute preceding invoices.

Draft billing changes recalculate only that draft against other active actual
reservations; old versions remain immutable. Note/date-only edits and posting
never reallocate tax. The final invoice absorbs each remaining component exactly.
Credits release exactly the credited invoice's saved allocation, not a fresh
calculation at current rates. Applied payments are released through the same
existing lifecycle; the original order payment remains recorded.

Tax-aware line capacity comes from the accepted tax agreement's line gross,
including its frozen source-discount allocation. It is never replaced by another
proportional distribution of the original quotation total. Gross quantity/value
limits, component limits and one accepted order obligation remain mandatory.

The approved-source boundary remains INR and supported charge-free pricing.
Unclassified commercial charges, unsupported currency conversion or mismatched
prices cannot enter by selecting another invoice mode. Statutory eligibility,
place/time-of-supply decisions and electronic-invoicing rules remain P13C work.

## Storage and authorization

Migration `20261031000200_invoice_tax_allocations` adds two empty forced-RLS
children: immutable tax snapshots per invoice event/version and immutable full
credit snapshots linked to the original posted invoice-tax version. Runtime
accounts can read these children through their native invoice/credit ancestry;
triggers create them. Clients cannot write independent tax evidence.

An invoice source explicitly records `COMMERCIAL` or `TAX_AWARE`. The latter
retains the exact native accepted tax snapshot and independently frozen billed
portions. Existing ordinary commercial records are not relabeled or backfilled.
The same module permissions, parent Read/action limits, office ancestry,
Restricted sharing, tenant isolation, security mutex and strict audits apply.
No tax-directory Read permission is needed to inspect already accepted facts.

All invoice operations serialize through the saved order and use exact native
numeric proof. Deferred constraints enforce component/value/quantity balances
and require an ordinary invoice event for every tax version. Audit failure rolls
back numbering, allocations, credit snapshots and released payment applications.
Five existing billing guards are explicitly extended; prior rows, policies,
other functions, source snapshots, grant settings and PDF archives are retained.

## Verification

`npm.cmd run test:invoice-tax` runs the disposable localhost migration/native
suite. After a build, append `-- --browser-only` for tax-aware and commercial UI
flows. Verify exact final component remainders, edits/cancellation, full credit,
payment reuse, negative access, forged evidence, concurrency, audit rollback and
the statutory-document gate. Hosted tests use isolated staging QA through the
ordinary authenticated APIs/UI; no fixture/seed is run against hosted databases.

## Verified staging release - 2026-10-31

Runtime `29d1a84` is READY on all four staging aliases, deployment
`dpl_Bs4gWPezw3JqX5RTuvmhTjq4tPiB`. Migration history is 146. All 65 unique
checks are verified across the main and focused reruns: 57 other regression/unit
checks and eight native tax-invoice checks. Three browser flows, build and
targeted lint passed. Local and hosted desktop/mobile summaries were inspected.

Hosted isolated QA verified exact partial/final net and tax totals, full credit
of the original allocation, identical component restoration on rebilling,
statutory PDF denial, foreign-tenant denial and frozen evidence after master
archival. Preparation/pricing UI and source snapshot preservation were retained.
QA posted invoices were credited, the replacement draft and order cancelled,
and temporary mapping/configuration restored or archived. No money was collected;
immutable QA financial history remains.

The staging cutover preserved all 158 preceding tables and existing policies.
Five reviewed billing functions were extended; other functions and prior triggers
were retained. The initial SQL CASE syntax error was caught in local rehearsal
and corrected before successful application. No migration history was rewritten.
A fresh 2,593,860-byte custom backup passed encryption/decryption hash and archive
restore-list verification, not a full restore rehearsal. The owned localhost
fixture was removed after testing.

The implementation and verification notes are committed locally. No Git push or
production deployment occurred. Production aliases, GitHub main and the root
Vercel production link remain unchanged. Next is P13C statutory document types,
registration/financial-year numbering, mandatory particulars and applicable
electronic-invoicing controls; this release does not enable statutory issuance.
