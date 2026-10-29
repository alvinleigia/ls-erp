# P11 commercial invoices and credit notes

Commercial invoices reuse accepted Sales Orders, existing receivables and posted
payments. They work across industries; Real Estate remains a source adapter.
This increment is commercial invoicing/payment requests, not statutory GST
invoicing, general-ledger accounting or partial/milestone billing.

## Usage

1. Platform admin allows Commercial Invoices for a tenant; the tenant enables it.
   Receivables and its dependencies must already be active. Nothing is enabled
   or granted automatically by the migration.
2. An authorised user opens a confirmed Sales Order and selects **Create invoice
   draft**. The customer, participants, currency, prices, discounts and charges
   are copied exactly from that accepted order. Only dates and the customer note
   can be edited in the draft. Pending-price orders cannot be invoiced.
3. Open the order's receivables, then **Post invoice**. Posting assigns a private
   tenant-wide `INV/000001` number and freezes the invoice. It references the
   existing order obligation and never creates a second debt.
4. **Apply recorded payment** explicitly applies an existing posted payment on
   the same order. Applications cannot exceed either available payment or invoice
   balance. **Release application** preserves history and does not refund money.
5. A tenant administrator publishes the issuing company's Commercial Invoice and
   Commercial Credit Note templates in **Settings → Documents**. Both reuse the
   structured template editor, approved fields, required sections and branding.
   Prepare/preview does not save a PDF; issuance saves the exact immutable file.
6. Cancel an unused draft with a reason. A posted invoice instead requires a
   **Full credit note**, with a reason and effective date. This assigns a `CN`
   number, releases its applications and retains the invoice/history. Recorded
   payments and order receivables are unchanged; refunds and order cancellation
   remain explicit separate actions.

Only one draft or posted invoice may exist per order. A fully credited or
cancelled invoice allows a fresh full-order draft. A posted invoice blocks order
cancellation even if Commercial Invoices is subsequently disabled.

## Access and integrity

The independent `customerInvoices`, `invoicePayments` and `invoiceDocuments`
resources inherit Sales Order sharing, Restricted visibility and native office
boundaries. Parent Read and current activation remain mandatory. Apply/release
also require existing-payment Read; full credit requires application-release
authority. Missing payment permissions omit optional balances/history rather
than granting access. Company-template publication retains actual Tenant Admin
authority. Resource registration itself grants no permissions.

Serializable source locks, optimistic versions, request identities and native
constraints protect transitions and balances. Invoice/credit events, payment
applications/releases and document archives are immutable. Audit failure rolls
back the operation, including numbering. Native source RLS and cancellation
guards remain independent of UI controls.

The generic issuance engine rechecks facts and access after rendering, removes
unused uploads on invalidation, and supports immutable replacement chains.
Credited invoice PDFs require explicit historical acknowledgement; downloads
return the exact archived bytes. Credit notes have their own current PDFs.
Recovery inventory includes invoice and credit-note files and embedded branding.

## Migration and verification

Migration `20261030000200_commercial_invoices` adds seven tables plus source
integrity guards; it does not rewrite earlier records, access profiles or module
activation. Existing tenant data is preserved. Operator deployment must target
staging first and retain a verified encrypted application backup.

The local suite covers exact source prices, draft edits, request replay, active
invoice uniqueness, posting/date checks, payment applications/releases and
reversals, concurrency, full credits, numbering/audit rollback, cancellation with
the module disabled, tenant/office/Restricted and parent/action scopes, native
tampering, real PDF rendering, historical downloads and rendering races.
Browser checks exercise company templates, draft/post/apply/credit and both PDF
types, with mobile/desktop captures. Existing order/receivable/receipt/document
storage and recovery checks remain regression requirements.
