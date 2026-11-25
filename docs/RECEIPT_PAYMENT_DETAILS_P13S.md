# Payment allocation and receipt details - P13S

## Behaviour

Record an externally received payment against a confirmed order with open
receivables. Choose **Automatically allocate by due date**, or **Specific
instalments or charges** and enter amounts against the existing schedule lines.
A single payment and receipt may cover several lines, including a booking
instalment and a separately payable charge such as PLC. Included charges remain
part of the agreed consideration; they must not be collected twice.

Explicit allocations must reconcile exactly to the amount received, use the
currency's precision, and stay within each selected line's outstanding balance.
Foreign-order lines, duplicate lines, zero/negative allocations, stale account
versions and overpayments are rejected atomically. Automatic allocation keeps
the existing earliest-due behaviour. Retry keys bind the bank details and any
explicit allocation, with ordinary correction/refund history retained.

Optional payer bank and transfer/instrument type (NEFT, RTGS, IMPS, wire or
demand draft) supplement the existing payment method and transaction reference.
They do not establish a receiving bank account, initiate a transfer or collect
money. The saved payment remains immutable.

## Receipt facts

The shared payment receipt includes the actual amount, payment date, method,
optional payer bank, transaction reference and order reference. It also captures:

- Agreed booking/order receivable total, net posted payments and outstanding.
- For each allocated line: scheduled amount, this payment and remaining balance.
- Customer participants and correspondence from the accepted order snapshot.
- Real Estate's accepted project/unit/area facts, supplied by its addon through
  application composition, without querying live catalogue names or prices.

Balances are explicitly **as of receipt issuance**, not reconstructed as of a
backdated payment date. Later payments/refunds leave the archived original
unchanged. Another financial write during preview/render invalidates the review;
the user must review a fresh preview before issuance or replacement.

For example, a scheduled instalment of 551,100 with a payment of 500,000 has a
51,100 remaining instalment balance only when no other payments apply. Total
booking outstanding is shown separately and may be much larger.

Interest and payment-level discounts are not inferred from text, automatically
charged or filled with invented zero amounts. There is no new financial
adjustment ledger in this change. Agreed quotation discounts and included/extra
charges retain their existing calculations. This receipt is not a tax invoice.

## Preservation and rollout

Migration `20261125000100_receipt_payment_details` adds two empty optional payment
columns and a native receipt-evidence guard. Existing payments, allocations,
permissions, templates and issued snapshots/PDFs are not rewritten. The native
guard rechecks exact bank metadata, account version, posted totals and allocated
line balances under the same source lock as payment recording/refunds. Apply the
migration and matching application release together: new receipt issuance now
requires balance evidence. Previously issued receipts remain downloadable.

The new dynamic fields and examples reuse the existing template editor and
prepare/review/issue/storage flow. Existing required payment/allocation/reference
sections remain protected. A prepared Ewissen sample retains all 11 saved terms
and fits one page at 9 pt with compact spacing; longer addresses, participants or
allocations paginate normally rather than losing information.

## Verification commands

`npm.cmd run test:payment-documents` rehearses all migrations in a disposable local
database, including forced rollback and preservation checks for the new migration,
then runs receipt, receivable, document and source-access integration checks.

`node scripts/test-sales-orders.cjs --payment-documents --browser-only` runs the
isolated real browser flows for allocation, receipt preview/issue/refund and order
document regression. No hosted pilot transaction is used for these checks.

Additional source checks: `node --require ./tests/register.cjs --test
tests/receipt-details.test.cjs tests/document-layout.test.cjs`.

Final release-candidate verification on 2026-11-25: build/TypeScript and targeted
ESLint passed. The complete isolated run passed 106 automated checks and seven
browser flows, including selected-line payments, template publication, nested
fields, column resizing, receipt issue/refund/download and letterhead copies.
Forty-three focused layout/PDF/letterhead checks also cover table-header emphasis,
charcoal bold text and reserved signing space. Desktop/mobile captures and PDFs
were inspected. Evidence: tmp/industry-release/ls-erp-sales-orders-45d8bb813026.log.

## Template presentation

The payment section may be replaced only by its complete registered set of
financial fields and the historical receipt notice. Repeating customer,
allocation and order-reference sections remain mandatory, including inside
columns. Real Estate facts come from accepted source evidence, not the live
catalogue. See DOCUMENT_LAYOUT_COLUMNS_P13S.md for shared editor controls.

The reviewed Ewissen configuration uses two-column customer/payment details,
three-column balances and a full-width repeating allocation table. Labels use
charcoal bold (#4d4d4d), values remain regular and table headings have modest bold
emphasis. The company and authorised signatory use the same charcoal bold.
Requested paragraph gaps and two signing lines are retained. All 11 saved business
terms fit in the one-page sample; longer real data paginates normally.

Prepared private configuration:
tmp/ewissen-receipt-template/columns-template-draft.json.
Reviewed PDF: output/pdf/ewissen-payment-receipt-signing-space-preview.pdf.
These client artifacts must not be committed. Publish the configuration through
the tenant's audited template API after deploying the matching shared application;
existing company settings, other templates and issued documents stay unchanged.
