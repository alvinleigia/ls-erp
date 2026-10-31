# P13C — GST numbering, print preparation and manual signing

## Supported boundary

This increment supports reviewed domestic forward-charge INR tax invoices,
nil-rated/exempt bills of supply, and full credit notes linked to their completed
original document. The issuing registration must explicitly say e-invoicing is
not required. Current support retains the preceding approved, charge-free source
and frozen invoice-allocation bounds. It does not infer eligibility from industry,
turnover, an address, a description or the size of a payment.

Electronic signing is an explicit separate mode. Reviews and draft previews can
record it, but number reservation/finalization is blocked until an actual verified
signing provider is connected. A typed name, ordinary generated PDF or unchecked
upload is not a verified electronic signature. No IRN or government-signed QR is
invented. Required/unassessed IRP cases, required dynamic QR, exports/SEZ, reverse
charge and zero-rated/non-GST supplies remain blocked. Advance vouchers, debit
notes, partial statutory credits, statutory cancellation and return filing are
separate work. Commercial payment receipts remain commercial receipts.

Manual completion records a human attestation and the exact uploaded PDF bytes.
It does not cryptographically prove a signature or automatically determine legal
eligibility. The reviewer must check the signed copy against the frozen source.
The unsigned prepared PDF cannot itself be submitted as the signed copy.

The user confirmed that different tenants may use different signing providers.
Provider connectors remain pending. Their connections and server-side credentials
must be tenant-specific, with an explicit company binding where required; there
must be no global provider choice. A shared signing contract must bind callbacks
to the connection, tenant, document, immutable PDF hash and request. Finalization
needs verified provider evidence and preserved signed bytes, with idempotent
retries and fresh source authorization. Signing and IRP registration are separate
capabilities; connecting one must never satisfy the other's gate implicitly.

## User workflow

1. A tenant administrator configures the company registration and office mapping,
   customer tax identity, and reviewed goods/service profile. The profile needs a
   six/eight-digit HSN for goods or a six-digit SAC for services in this release.
   Review the source quotation, approve its reconciled tax pricing and accept the
   order using the existing workflow. Old commercial orders are not converted.
2. Publish the company's appropriate GST document template at **Settings →
   Documents**. All seven statutory sections must remain in the structured layout.
   The legal heading and supplier/recipient/signatory facts come from the reviewed
   document source; template wording cannot replace those identities.
3. Open receivables and post the internal invoice allocation. Its `INV` reference
   identifies internal billing; it is not a statutory GST number.
4. Open **GST documents and signing** on that invoice. Under the numbering-series
   section, create a fresh registration/year/type code after reconciling any
   statutory numbers already used outside this ERP. Never choose a code that would
   duplicate an existing external series. A different code is needed for credit
   notes. Search and pagination use the same scoped series population.
5. Review document type, tenant-today date, supply/tax-point date, delivery facts,
   authorized signatory, applicability and timing basis. For goods, record actual
   supplied quantities/UQC; equivalent partial-billing quantities are not actual
   dispatch quantities. Supplier, recipient, profile and tax values are frozen
   from the accepted source, not refreshed from current masters.
6. Save reviewed facts and download the watermarked preview. Preview reserves no
   number. Re-prepare if the source, review, branding, template or series changed.
7. Reserve the statutory number. This freezes its facts/template/logo and number.
   Then archive/download the prepared unsigned print copies. Goods tax invoices
   include recipient/transporter/supplier copies; service tax invoices include
   recipient/supplier copies. They share the same number. Preparation is not signed
   completion.
8. Obtain the authorized manual signature on the reserved document date. Upload
   the actual signed PDF, up to 3 MB, confirm that its number/pages/amounts/parties
   match, and record the completion evidence. It can be uploaded later if it was
   actually signed on that date. If it was not, void the unissued reservation and
   prepare a current document. Signed uploads are never recompressed, flattened or
   regenerated. Download retrieves their exact private archived bytes.
9. For a correction before signed completion, void the unissued number with a
   reason. Its number, review and any print archive remain in history. Voiding
   does not cancel/credit the financial invoice. An unprinted reservation from an
   earlier day must be voided rather than backdated or silently re-rendered.
10. For a full credit, use the existing financial full-credit action, then review
    and complete the statutory credit note. Its original statutory reference/date,
    full tax values and financial credit reason are frozen. The original must
    already be completed. A financial credit before original signing instead
    requires voiding that unissued original; it cannot manufacture an issued
    original retrospectively. Downloading a credited original requires explicit
    historical acknowledgement. No second debt, money collection or refund occurs.

## Numbering, access and persistence

References use `CODE/YYZZ/000001`: code 1–4 uppercase alphanumeric characters,
starting with a letter; April-start financial year; serial 1–999999. The result
is at most 16 characters. Codes are unique per tenant/registration/year across
document types. Series identity is immutable; its enabled state uses optimistic
versions. Disabling prevents new reservations; it does not rewrite or revoke an
existing reserved number. Void an unissued reservation explicitly when needed.
Issued signed documents cannot be edited, deleted, voided or replaced in place.
Exhausted counters fail closed; no reset, rollover or number reuse is offered.

Current reservation/print/signing/void/series/review writes require the actual
Tenant Admin, tax configuration Read/Edit, invoice-document Create/Export, and
current invoice/order/receivable Read. Read, Create and Export record limits are
checked separately, after the shared security lock. Role labels, team membership
and a tax configuration grant cannot widen source visibility. Historical Read and
Export do not require current tax-master Read or enabled templates. Current tenant,
account, module, office, sharing and source limits remain mandatory. Closed issuing
companies/offices and changed issuer/e-invoice assessments block new preparation
or completion; they do not rewrite historical files.

Five additive native tables hold immutable series identity/private counters,
source-versioned reviews, reserved documents and exact transition history.
`RESERVED → PRINT_READY → ISSUED` is the manual lifecycle; unissued states can
transition to `VOID`. Every document transition requires exact immutable history.
Numbers and reservations commit before external rendering/storage. A render or
upload failure can retry the same frozen reservation. Ambiguous commit failures
never trigger blind deletion of a potentially referenced storage object.

India-specific readiness, numbering and PDF contracts live in
`platform/tax/localizations/india-statutory*.ts`. The invoice source adapter owns
authorization and persistence. The existing template editor, PDF renderer,
branding, storage and source access contracts are reused; there is no Real Estate
dependency, tenant override, master-data enrichment or legacy application path.
The separate statutory root supports pre-signing number reservation without
changing the existing commercial immutable-PDF chain or its tax-aware fallback
denial. The recovery inventory now checks frozen logos and both archives, including
voided numbers. Storage recovery must preserve every referenced object.

## Verification and release

Run `npm.cmd run test:statutory` for guarded disposable-localhost unit/native
checks, and append `-- --browser` for the real application/browser flows. No hosted
fixture/seed/reset utility is permitted. Hosted QA uses isolated staging tenants
and authenticated APIs/UI. Production remains a separate release with its own
verified backup and agreed window.

Local verification: all 38 unit/native/recovery checks and four browser flows
pass, as do the optimized build, TypeScript, targeted lint and whitespace checks.
Migration 147 passed forced rollback and populated preservation of all 160 prior
tables, policies, functions and triggers. The final native run covers preview
without allocation, exact signed bytes, void/no reuse, render retry, linked full
credit, policy/signing blocks, required classifications/sections, concurrent
source numbering and series edits, source/tenant access and audit rollback.
Desktop/mobile signing screens and all four PDF cases were visually inspected.

The browser test's initial Unicode label mismatch and off-screen dropdown action
were corrected in its locators/scroll handling. The local migration archive-path
syntax and inherited-office lookup errors were corrected before the successful
fresh rehearsal. No hosted migration history was rewritten. Staging backup,
migration and hosted verification are in progress; production remains unchanged.

## Primary references

The implementation bounds and accountant review should be checked against the
applicable consolidated [CGST rules](https://cbic-gst.gov.in/pdf/15102020_CGST-Rules-2017-Part-A-Rules.pdf),
including invoice particulars, copy rules, bills of supply and credit-note
references. The [official state-code directory](https://docs.ewaybillgst.gov.in/apidocs/state-code.html)
supplies the supported domestic state/territory choices. GSTN's
[e-invoice overview](https://tutorial.gst.gov.in/downloads/news/pamphlet_e_invoice_overview_updated_on_17_08_2023_approved_final.pdf)
describes the separate external registration process; this release does not
implement that integration or claim complete GST compliance.
