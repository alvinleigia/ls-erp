# P13B3 quotation tax pricing approval and order evidence

P13B4 adds [native invoice/credit allocations](INVOICE_TAX_ALLOCATIONS_P13B4.md).
Prepared orders now use those frozen portions for billing; the earlier P13B3
release boundary below records the gate before that integration. Statutory PDF
issuance remains separate and blocked pending P13C.

This increment connects prepared quotation tax inputs to an explicit pricing
review and immutable Sales Order acceptance. The shared calculation and review
controls live under `platform/tax`; Sales Documents owns source authorization,
and Sales Orders owns accepted evidence. No Real Estate or tenant-specific rule
is introduced.

## Workflow

1. Save a quotation revision and prepare its reviewed tax inputs.
2. Open **Tax preparation**, then **Review tax-aware pricing**. Check each
   line's discount, net value, percentage components and gross value.
3. Enter the pricing review basis and confirm the review. Only an actual Tenant
   Admin with quotation Read/Edit and tax-configuration Read can approve.
4. Choose **Approve reconciled pricing**. The source's agreed total must match
   exactly. Approval never edits the quotation, recalculates an archived PDF or
   adds tax on top of an already agreed amount.
5. Create the Sales Order using the ordinary authorized action. Its unchanged
   quotation revision and a native accepted tax record are saved atomically.
   The order shows **Accepted tax agreement** independently of tax-directory
   permissions. Confirmation, cancellation, reservations and receivables retain
   their existing separate authority and transitions.

Approval is immutable and bound to one prepared revision, its profile versions
and calculation policy. Corrections require a new quotation revision. Preparation
must still be current when approved: changed registrations, customer identities,
office mappings, profiles or directory rates require fresh preparation. Once
accepted, master edits never rewrite the agreement or customer evidence.

## Supported pricing boundary

The current India GST approval adapter supports INR quotations without commercial
charge rows. It calculates the saved lines using their explicit prepared pricing
profiles. A quotation-level discount is allocated across saved line amounts by
largest remainders; ties use source-line order. The allocated discount totals
exactly, and each line's net plus tax equals its gross. Native database proof
independently validates the same exact calculation and reconciled source total.

Inclusive prices retain the quoted gross. Exclusive prices that would increase
the agreed total cannot be approved. Choose the correct reviewed profile and
customer-agreed quotation in a new revision; there is no hidden override or
automatic price amendment. Commercial charge descriptions, including charges
named GST, never become tax components. Such quotations remain blocked until
their charges receive an explicit supported classification. Foreign-currency
approval also remains blocked pending a reviewed tax-currency conversion contract.

These are explicit staging boundaries, not statements that all tax cases are
implemented. Missing configuration never becomes an exemption or a zero rate.
Approval reconciles pricing; it does not certify statutory eligibility,
place/time-of-supply law or electronic-invoicing requirements.

## Native integrity and access

Migration `20261031000100_quotation_tax_pricing` adds two empty forced-RLS tables:
`QuotationTaxPricingApproval`, a child of prepared quotation evidence, and
`SalesOrderTaxAcceptance`, a child of the Sales Order. No existing business row,
grant, assignment, office, quotation snapshot or archived PDF is backfilled.

The P13B2 order guard now requires approval and the exact original source
snapshot/prices. An additional native trigger freezes the acceptance evidence
in the order transaction. Typed foreign keys, exact snapshot proof and immutable
rows prevent client-supplied accepted tax facts. Runtime accounts can only read
the accepted child; ordinary order insertion creates it through the native
guard. Order audit failure rolls back both order and accepted evidence.

Fresh source permissions, Restricted sharing, office ancestry and tenant/module
bounds remain mandatory. Approval uses the tenant security mutex and quotation
lock. Ordinary authorized quotation readers can inspect saved approval; ordinary
order readers inspect accepted evidence through the order's own scope without
current master-directory access. Reading either grants no approval authority.

## Invoice boundary and next work

Tax-aware orders cannot enter the existing commercial invoice creation path.
The native invoice guard blocks that fallback until P13B4 supplies frozen native
tax allocations for partial/final invoices and credits. Existing unprepared
commercial orders and their billing continue normally. Commercial payment
receipts do not become statutory advance vouchers.

P13B4 must allocate accepted line/component balances cumulatively, preserve exact
final remainders and link reversals to original facts. P13C remains responsible
for statutory document types, series, mandatory particulars and applicable
electronic-invoicing controls. This phase is staging work, not production GST
billing or statutory go-live.

## Verification

Run `npm.cmd run test:tax-pricing` against its disposable localhost database;
after a build use `-- --browser-only` for the UI flow. The suite includes native
pricing proof, discount rounding, immutability, scope/tenant denial, stale facts,
concurrent approval, audit rollback, accepted evidence and the commercial invoice
gate, alongside the preceding preparation and financial regressions. The migration
rehearsal checks forced rollback and all prior data/policies/functions, allowing
only the explicitly replaced P13B2 order guard.

## Verified staging release - 2026-10-31

Runtime `84d34e3` is READY on all four staging aliases, deployment
`dpl_7ykiEe4QhBvxGZYU8A3yXrC81KVQ`. Migration history is 145. All 55
unit/native/financial checks, two desktop/mobile browser flows, build and targeted
lint passed. Local and hosted desktop/mobile screenshots were inspected.

Hosted isolated QA verified preparation and pricing approval through the UI,
unchanged quotation snapshots, approved order creation, frozen accepted evidence,
stale/duplicate and foreign/cross-origin denial, the unapproved-order gate and
the commercial invoice block. Evidence remained unchanged after master archival.
The QA order was confirmed for the invoice check and then cancelled without
collecting money. Its immutable history remains. The office's prior registration
mapping was restored; temporary issuer/recipient records were archived, the
profile disabled and its rate made inactive.

Before migration, a fresh 2,557,424-byte custom archive was encrypted and verified
by decryption/hash and restore-list checks. This was not a full restore rehearsal.
The migration preserved exact values in all 156 prior tables and existing access
policies. Only the explicitly reviewed P13B2 acceptance function was replaced;
other stored functions and all existing triggers were retained. No history
checksum was rewritten. The owned localhost fixture was removed.

Production aliases, GitHub main and the root Vercel production link remain
unchanged. This increment is committed locally and deployed to staging through
the isolated release checkout; no Git push or production deployment occurred.
P13B4 tax-aware partial/final invoice allocations remain the next increment.
