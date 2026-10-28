# Shared customer participation and booking plan

Research date: 2026-10-28. Status: phased implementation authorized; P1 foundation
is verified locally on the `staging` branch. See [P1 delivery evidence](PARTICIPANTS_P1.md).
R10 production phase 6F is complete.
No production deployment/migration or alteration of existing customer records is
part of P1. Hosted staging deployment evidence is separate from local verification.

## Decision

Standardize the business concepts before adding screens. Use the pilot's CIF
screens as evidence of its current process, not as the product specification.
Build reusable customer participation on top of the existing person/business
masters and sales flow. Real Estate supplies joint-applicant and property rules.
Do not reproduce every uploaded form field in the first increment. The shared
document-generation foundation and the two sample Real Estate letters are now
explicitly included as a later increment. KYC file uploads, electronic signatures
and ownership calculations remain excluded unless separately requested.

The intended stable boundaries are:

- Customer master: who the person or business is, independent of any purchase.
- Transaction participants: who is involved in this particular deal and in what role.
- Sales order: the commercial commitment, presented as Booking where appropriate.
- Reservation/allocation: the separate claim on a unique item or property unit.
- Receivable/payment: the existing financial record, separate from participation.
- Industry extension: property details and explicit allotment rules.
- Business documents: authorized source providers, frozen issuance data and
  versioned templates; Real Estate owns its letter templates and property inputs.

The design should support new participant roles and industry extensions without
changing the core transaction lifecycle. This is an extension boundary, not a
promise that future requirements will never need schema or service changes.

## Research findings

Only vendor documentation/source was used. These products have useful patterns;
their features and legal/financial meanings are not interchangeable.

| Product | Verified pattern | Application to our design |
| --- | --- | --- |
| Odoo 19 | Contacts represent persons/companies with associated contacts and addresses. Confirming a quotation produces a sales order. Standard `sale.order` has one main `partner_id`, with separate invoice/shipping contacts. | Reuse a customer master and sales lifecycle. Do not claim that multiple joint applicants are a standard Odoo sales feature. |
| Odoo Studio | Relational rows can represent multiple linked records; optional fields and layouts can be extended. | Applicants must be repeatable related rows, not fixed numbered fields or unvalidated free text. |
| ERPNext | Customer is the consistent commercial party across transactions; contacts and addresses are linked records. Orders reference customers/items and can carry payment schedules. | Separate reusable identity and commercial records. Keep payment schedules with the sales/financial flow. |
| SAP S/4HANA | Partner functions distinguish sold-to, bill-to, ship-to and payer; one party can perform multiple functions. | Define transaction roles explicitly. Primary applicant does not automatically imply sole payer or owner. |
| Dynamics 365 Sales | Multiple contacts can be linked to an opportunity as stakeholders with roles; internal sales-team participants are distinct. | Separate customer participation from employee responsibility and security access. |

Sources, checked 2026-10-28:

1. [Odoo Contacts](https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html).
2. [Odoo quotation/order workflow](https://www.odoo.com/documentation/19.0/applications/sales/sales/sales_quotations/create_quotations.html).
3. [Odoo 19 sale.order source](https://github.com/odoo/odoo/blob/19.0/addons/sale/models/sale_order.py).
4. [Odoo relational fields](https://www.odoo.com/documentation/19.0/applications/studio/fields.html).
5. [ERPNext Customer](https://docs.frappe.io/erpnext/customer), [Contact](https://docs.frappe.io/erpnext/contact) and [Sales Order](https://docs.frappe.io/erpnext/sales-order).
6. [SAP partner functions](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/3cb1182b4a184bdd93f8d62e3f1f0741/806fbd534f22b44ce10000000a174cb4.html).
7. [Dynamics opportunity stakeholders](https://learn.microsoft.com/en-us/dynamics365/sales/add-stakeholder).
8. [Odoo down payments versus instalments](https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/down_payment.html).

Odoo also advertises a Real Estate Agency industry package. The retrieved official
description covers listings, visits, relationships and closing sales. It does not
establish developer-side joint-applicant, allotment or CIF rules. The detailed
industry page could not be fetched reliably; no such feature claim is inferred.
See [the official industry listing](https://www.odoo.com/industries/real-estate-agency).

The recommendation below is our design synthesis, not a claim that all four
products implement an identical CIF process or that CIF has a universal meaning.

## Current ERP fit and gaps

- `CrmContact`, `CrmAccount` and their relationship already represent people and
  businesses. Reuse them rather than introduce a parallel CIF customer directory.
- Contacts/accounts are tenant-shared masters with existing access controls.
  Opportunities and their sales children carry the canonical office boundary.
- Sales Orders, saved quotation revisions, unique-unit reservations, receivables,
  receipts and reversals already exist. Current order creation requires a saved
  quotation revision. These are the reusable commercial/financial foundations.
- Orders currently preserve customer display data in the source snapshot. There
  is no dedicated repeatable joint-applicant relationship or CIF lifecycle.
- Terminology and typed custom fields already exist, but contact/order fields and
  lifecycle requirements need explicit registration; they are not automatically
  configurable today.
- Contact phone/email currently have tenant-wide uniqueness. Before introducing
  joint applicants, review shared-family contact details: email/phone are useful
  duplicate signals, not proof that two people are the same person. Do not relax
  these constraints without testing imports, conversion, selectors and matching.

## Proposed minimum contract

### 1. Reusable identity

Retain stable IDs for people and businesses. Customer status is a commercial
relationship, not a new login or employee account. A company may buy with a person
as its representative; an individual can buy directly.

Each record may participate in many deals, with different roles on each. Do not
make a spouse/co-applicant a permanent attribute of the primary person's record.
Identify people by stable record ID; any supported merge must be explicit and
audited. Never auto-merge joint applicants solely on shared email, phone or address.

### 2. Repeatable transaction participants

Use related rows with typed person/business references, stable role codes and
tenant-safe foreign keys. The owner module supplies a registered source/access
adapter; do not expose an arbitrary table-name/entity-ID attachment API.

Initial stable role codes are `CUSTOMER`, `ADDITIONAL_CUSTOMER` and
`REPRESENTATIVE`. They cover main customer, additional customer participant and
representative. Real Estate maps the customer participants to Primary applicant
and Co-applicant and supplies any additional relationship metadata.

- One clearly designated main customer; zero or many additional participants.
- No fixed coApplicant1/coApplicant2 columns or single free-text co-applicant.
- The same person can appear in different transactions and appropriate roles.
- Reject duplicate participant/role entries on the same transaction.
- A business buyer can have several representatives; representatives are not
  automatically joint owners or liable for the balance.
- Relationship, ownership share, signing authority and payment responsibility
  have different meanings. Add their rules only when required, with explicit
  validation. Do not assume equal ownership or split a receivable by headcount.
- Snapshot the accepted participants/roles with confirmed commercial terms.
  Later customer edits must not silently change confirmed or issued documents.
  Corrections need an authorized, audited amendment/replacement path.

The contract is reusable. Start integration with opportunities and sales orders;
later modules explicitly register their own adapters. Sharing a UI component does
not make a new resource authorized or ready for every module.

### 3. CIF is a presentation and information-collection need

Do not require a new global CIF entity before every order. The default screen
can be Customer details / Participants; the Real Estate preset may call it CIF.
Customer reference, application reference and booking reference identify different
things and must not be conflated.

If the pilot needs a separately submitted application with approval, expiry or
multiple resulting bookings, define a dedicated application record in a later,
explicit scope. A requirement for an independent lifecycle, rather than a field
label, justifies that record. Its relationships must allow reuse across bookings.

### 4. Configuration without an unrestricted workflow engine

Provide a versioned industry preset and tenant configuration for labels, optional
fields and a small set of requirements at named transitions, such as confirming
an order. Drafts may be incomplete; confirmation explains missing requirements.
All transition requirements are server-enforced, including imports and APIs.

Core IDs, amounts, statuses, source references and access controls remain fixed.
Additional descriptive facts can use typed custom fields. Participant relations,
payments, unit exclusivity and authorization are structured business rules.
Country-specific identifiers are not globally mandatory fields. Store sensitive
identifiers/documents only within an explicitly approved, permission-controlled scope.

Persist the applied configuration version at the relevant acceptance boundary.
Tenant configuration changes must not rewrite old signed/confirmed facts or
silently expand permissions. Publishing a requirement needs an impact preview
for open drafts; historical records are not rewritten to appear complete.

### 5. Reuse booking, allocation and finance

Use existing Sales Orders with Booking terminology for appropriate tenants.
For now keep the saved-quotation source contract. A shorter creation screen may
compose the existing steps; direct orders would be a separate source-contract
change with its own review, not a bypass added to the CIF form.

Keep independent state axes: order confirmation/cancellation; reservation
held/allocated/released/expired; and financial due/received/reversed balances.
Real Estate may add allotment eligibility/action through its extension. Do not
reduce all these states to one Active checkbox or inherit a client's payment
threshold globally. Support individually identified assets using the existing
catalogue contract without making every industry's order require property fields.

One order counts once in commercial KPIs regardless of applicant count.
Collections derive from receipts; applicant counts are a separate measure.
Employee/team attribution and partner introduction retain their existing meanings.

### 6. Existing security and history remain authoritative

Participant or family relationships confer no login, profile action, team
membership, sharing grant or office access. Channel partners and responsible
employees remain distinct from customer participants. Access must cover the
record, related selectors, exports, reports and any document download.

If private document collection is later approved, add a dedicated identity-document
boundary on top of readable parent records. Ordinary booking Read must not expose
all KYC files. Use private storage and short-lived authorized downloads, with
masked presentation and suitable audit events. Do not reuse public branding access.

## Phased delivery and acceptance

| Phase | Deliverable | Acceptance evidence |
| --- | --- | --- |
| P1: contract and source evidence | Define terminology, primary/billing-party meaning and participant roles. Implement the shared snapshot contract and capture authoritative identities in new quotation revisions. Document letter-input ownership. | Generic person/business cases, multiple participant rows, exact selected source, immutable copies, strict input and existing access tests. No invented historical links. |
| P2: shared participation | Repeatable participants, stable roles, person/business references, existing access integration and source-to-order snapshots. Review duplicate rules before changing them. | Individual, several co-applicants, business with representatives, one person on several deals, shared-family contact details, denied selectors and cross-tenant/office cases. |
| P3: form presets and validation | Common details screen; Real Estate labels/roles; bounded versioned requirements and precise missing-information feedback. | Generic tenant works with Real Estate off; different property tenants use different optional requirements without different code; API/import parity and no retroactive mutation. |
| P4: booking composition | Connect participant acceptance to the existing quotation/order/reservation flow; add only necessary numbering/date metadata. | Concurrent unit holds, expiry, retries, confirmation/cancellation, unchanged receipts/balances and no double-counted KPIs; multiple units follow existing order-line capability. |
| P5: shared document generation and Real Estate letters | Shared issuance/source/template contracts, then booking intimation and unit allotment templates owned by Real Estate. | Generic document provider works with Real Estate disabled; multiple applicants render correctly; frozen issued data, independent financial authorization, tenant/office privacy and controlled template corrections. No copied monetary/legal policy. |
| P6: migration and release | Rehearse the pilot upgrade against a fresh protected copy, then staging acceptance and separately approved production release. | Values, IDs, assignments, sharing, office bounds, snapshots, money and effective access match; complete recovery and release evidence. |

P1-P5 are the authorized phased feature direction. Finish and verify each increment
before depending on it. KYC file collection, electronic signing, ownership shares,
an independent application approval workflow and automatic penalties are not
implicitly included. Production execution remains a separately approved release.

## Document generation contract and input ownership

The core owns source authorization, template identity/version, immutable prepared
data, issuance reference/audit and existing private-storage mechanics. Each owning
module registers a typed document provider with its canonical resource/source and
required actions. An arbitrary entity type/ID or caller-supplied total must never
be sufficient to generate or issue a document.

Real Estate owns `booking-intimation` and `unit-allotment` template content,
property projections and allotment eligibility. These must not appear as special
cases in the shared renderer, participant service or sales-order core. Other
industries can register different providers against the same issuance contract.
Template text/branding can vary by tenant using stable template identities.

Prepare a bounded, authorized issuance snapshot in a fresh transaction. Rendering
and storage IO run outside the transaction; recheck current authority before
committing issuance, using the existing quotation issuance pattern where suitable.
Never regenerate an issued letter from changed contact data or current balances.
Keep its original facts, template version and exact issued PDF, with an explicit
superseding/reissue history for corrections. A preview is not an issued document.

| Inputs used by the two sample PDFs | Owning capability | Implementation boundary |
| --- | --- | --- |
| Main/additional applicant names and communication details | Shared person/business masters and transaction participants | Repeatable people with stable IDs; freeze chosen fields for the document. |
| Address and country-specific identifiers printed in the sample | Shared customer information plus protected identity-field scope | Add only the required fields with appropriate access. Identity values are not KYC file uploads; no globally mandatory PAN/Aadhaar or printing by default. |
| Customer/application/booking references and booking date | Shared customer and commercial reference contracts | Distinct meanings and tenant-safe numbering. Do not repurpose a technical ID or assume CIF and CSN are interchangeable. |
| Supplier/company name, branding, contact details and signatory caption | Issuing operating company and versioned template configuration | Tenant/issuing-company context, not one global pilot brand. A printed signatory caption is not electronic signature capture. |
| Project, subproject, unit number and area | Real Estate document provider | Use the authorized selected property/source snapshot; no property columns in the core participant/order contract. |
| Agreed consideration and payment schedule | Saved commercial revision and receivables | Exact existing decimal amounts/date rules; no copied or client-entered totals. |
| Payments received, outstanding amounts and additional charges | Existing financial source adapter | Prepare authorized values as of issuance. Keep pending charges explicit; retain existing posting/receivable guards and do not treat unknown charges as zero. |
| Letter wording, conditions, issue eligibility and property-specific notes | Real Estate provider and tenant template version | Client-approved content, separately defined booking versus allotment actions; no hard-coded sample interest/forfeiture/ownership rule. |

Documents must list all intended applicants rather than a single co-applicant
placeholder. Generating these two PDF types does not require collecting KYC scans,
capturing electronic signatures or calculating ownership percentages.

## P2 storage and editing boundary

The first editable integration belongs to CRM's opportunity source. Its native
participant child records need composite tenant/source foreign keys, typed person
or business references, per-role uniqueness and source-inherited restrictive RLS.
Do not create one untyped global attachment table containing arbitrary resource
names and IDs. The shared contract/builder is reusable; each future owner registers
its authorized adapter and native source relationship.

Keep the opportunity's existing main contact/business relationship canonical.
Additional participant rows must not create a second independently editable main
customer. New or changed selections require readable, eligible master records;
unchanged saved selections must not disappear merely because directory access is
lost. Persist the minimal authorized display evidence needed for source reads.
Explicit refresh/correction must never silently overwrite accepted versions.

Participant replacement uses the source's optimistic version and row/security
locks. Validate all selections before saving any rows and commit the source
change and strict audit together. Source changes must not turn participant editing
into Assign, Share, Archive or document-issue permission.

Use a common repeatable participant editor with typed reference choices and the
same scoped search/count/page/selected-label population. Real Estate supplies
labels and its approved optional metadata through application composition. Shared
UI and participant services must work with Real Estate absent or disabled.

Quotations take an accepted snapshot of source participants. Orders continue
copying the exact selected quotation revision. Do not attach a live participant
list to a confirmed order or infer missing historical IDs on read. New source
fields/form requirements and native storage require their own migration,
preservation, access and browser checks before P2 can be called complete.
Include the supported maximum participant count in save/read/financial regression
checks; small happy-path snapshots alone are not a performance acceptance test.

## Pilot data migration rules

Preserve current contacts, accounts, deals, orders, units, source snapshots and
permissions. Backfill participation only from unambiguous recorded relationships;
never reconstruct a historical customer solely from the opportunity's current
contact, a name match or a shared email. Retain original snapshot evidence where a
historical link cannot be proved, and report unresolved links for reviewed mapping.

Use a one-time, dry-run-capable utility with a reviewed mapping and reconciliation
receipt if data translation is required. Do not introduce dual writes, per-tenant
runtime overrides or permanent old/new service branches. Normal domain snapshots
remain history, not a second legacy implementation.

No production mutation, mass backfill, new module activation or extension of
existing profiles is authorized by this plan.
