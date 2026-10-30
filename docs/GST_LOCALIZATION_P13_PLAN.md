# P13 shared tax foundation and India GST localization

Status: P13A company registrations/profiles, office mappings, exact arithmetic and
recipient identities are verified on staging, with runtime `0e2d65c` and migration
143. See [the configuration guide](TAX_CONFIGURATION_P13A.md),
[arithmetic contract](TAX_ARITHMETIC_P13A2.md) and
[recipient identity guide](CUSTOMER_TAX_IDENTITIES_P13A3.md).
P13B1 is verified on staging at runtime `94a870e`, adding the shared agreement
calculator and read-only saved-profile preview without a new migration;
see [its scope and remaining work](TAX_AGREEMENT_P13B1.md). P13B2 captures immutable
[quotation tax inputs](QUOTATION_TAX_INPUTS_P13B2.md) while deliberately blocking
prepared revisions from order acceptance pending tax-aware pricing approval.
Approved statutory source facts, native invoice tax allocation and issuance remain pending.
Production remains unchanged.

## Confirmed business scope

The user confirmed support for both property sales and brokerage/services, with
configuration per business and shared foundations across industries. This is
not approval of a particular rate or statutory treatment.
The supplied booking/CIF PDFs do not establish the
applicable tax treatment or provide a statutory tax-invoice specification.
Do not infer taxable supply, rate, exemption or place of supply from a CRM
industry label, property category or the text of a saved quotation charge.

Before statutory go-live, establish the actual issuing entity/registration,
business-approved supply classifications and whether electronic invoicing applies.
An unregistered customer, an exempt supply and a zero-rated supply are distinct
facts; a missing registration or rate is not permission to assume one of them.

## Current code boundaries

- `Tax` is the one tenant-owned exact percentage directory used by Services,
  Inventory, operational appointment orders and reviewed company profiles. Its
  rates do not independently establish a supply's statutory tax treatment.
- `TaxRegistrationType.GST` currently permits supplier directory information. It
  does not establish the issuing company's GST registration.
- Company registrations, office mappings and versioned recipient tax identities
  are available in P13A. Recipient selection and frozen supply evidence remain
  P13B work. Free-text addresses are not authoritative place-of-supply rules.
- Accepted quotation charges are plain commercial amounts/descriptions. Historical
  charges named GST must not be reclassified or charged again automatically.
- P12 freezes the accepted agreement separately from `CustomerInvoice.billing`.
  The billed amount includes the agreed commercial charges and is bounded by that
  agreement. Statutory tax cannot simply be added on top of an existing agreement.
- INV/CN counters and existing PDF providers are commercial. They must not silently
  become statutory series or tax documents. Existing archives retain exact bytes.

## Implementation sequence

### P13A: common registrations and exact tax arithmetic

1. Model business/party registrations with tenant-safe canonical owner references,
   jurisdiction, registration identity, legal name/address, status and version.
   Let offices select a registration belonging to their issuing company; retain
   registration identity separately from an office address or login/team.
2. Reuse the existing access resolver, company-administration boundary, resource
   registry, native RLS, optimistic versions and strict audit transactions. Reading
   a registration must not grant company, contact or business-record access.
3. Inventory current percentages and consumers, then standardize exact decimal
   rates and shared arithmetic. Preserve tax IDs and saved historical financial
   snapshots. Flag values that cannot be migrated exactly; never round or relabel
   them silently. Avoid a permanent independent tax engine just for CRM invoices.
4. Keep generic tax definitions/calculation contracts separate from country rules.
   Put India registration validation and GST component rules under an India
   localization. Real Estate supplies its own property facts through an adapter.

### P13B: approved source facts and frozen invoice tax breakdown

1. Capture supplier registration, recipient tax identity/status, supply
   classification, classification code, place-of-supply evidence, pricing basis,
   approved rate/component version and transaction dates at the proper source.
2. Require explicit configured treatment. Apply country and supply rules to those
   facts; do not use a universal rate or compare addresses as the whole decision.
3. Freeze taxable base, discounts, components, rounding and gross amount per
   accepted line. Partial invoices allocate those accepted components cumulatively
   so the final bill reconciles, without duplicating tax or order receivables.
4. Keep existing orders/invoices commercial unless their source is explicitly
   reviewed through the supported amendment/new-agreement process. Never fabricate
   missing tax evidence, rewrite accepted prices or regenerate historical PDFs.
5. Date/note edits must not silently reclassify or recalculate saved tax facts.
   Posting and issuance recheck current authority, source coherence and the
   explicit applicable configuration; master changes do not rewrite history.

### P13C: statutory document lifecycle

1. Add explicit statutory document types and appropriate registration/financial-
   year series. Retain commercial references as internal identities. Freeze the
   required statutory facts and number atomically with the authorized transition.
2. Reuse the structured template editor and immutable issuance engine. Required
   statutory sections cannot be removed by template wording or layout changes.
3. Keep tax invoices, bills of supply, advance-related vouchers and credit/debit
   documents distinct where applicable. The existing commercial receipt is not
   automatically a statutory advance voucher.
4. Reconcile credits/advances against their original frozen tax facts and P12
   allocations. No second collection, payable balance or invented refund occurs.
5. Determine electronic-invoicing requirements before enabling applicable issuance.
   Where required, block completion until successful authorized registration; never
   manufacture an official IRN/signed QR or treat a self-generated QR as one.

## Verification and release

- Build an accountant-reviewed acceptance matrix for the confirmed supply scope.
  Synthetic QA rates test calculation mechanics; they are not legal defaults.
- Test invalid/missing registrations, unsupported classifications, component
  selection, inclusive/exclusive pricing, discounts, partial/final rounding,
  advances, credits, configuration changes, concurrent numbering and audit rollback.
- Test tenant, office, Restricted sharing, profile/action and parent Read bounds
  across configuration, source choices, calculations, posting, reports and PDFs.
- Rehearse populated migration and forced rollback; preserve all prior source,
  invoice, receipt, payment, numbering, audit and archived-document facts.
- Deploy only to staging first, using isolated QA data and real private storage.
  Production rollout requires its own verified backup and agreed release window.
- General-ledger accounting, return filing and external provider integrations are
  separate deliverables unless the confirmed statutory workflow requires one for
  valid issuance. Do not imply that a PDF renderer alone completes GST compliance.

## Primary references checked for this design

CBIC's [Rule 46 tax-invoice requirements](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001)
establish that prescribed invoice particulars and numbering need explicit support.
Use the applicable consolidated rules/notifications when specifying actual cases.

Odoo's [India localization documentation](https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/india.html)
separates Indian accounting localization and electronic-invoicing services. This
plan follows that separation of responsibilities, without claiming the current
ERP already provides Odoo's accounting or statutory integration capabilities.
