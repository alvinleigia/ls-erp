# P13B2 reviewed source tax inputs

Tax preparation now belongs to a specific saved quotation revision. It captures
reviewed tax identities and profiles without changing the commercial source,
accepted amounts, billing allocations or archived PDF bytes. Shared validation,
validity checks and calculation remain in `platform/tax`; Sales Documents owns
the native quotation relationships, access probe and transaction. There is no
Real Estate dependency, inferred industry treatment or tenant-specific override.

## Current increment and acceptance boundary

This is **input preparation**, not statutory approval or tax-aware invoice
posting. A prepared revision cannot create a sales order until the next pricing
approval/acceptance integration is implemented. The database enforces this gate
even for direct inserts and concurrent writers. Existing commercial revisions
without tax preparation keep their normal order and invoicing workflow.

Do not release this preparation workflow to production as completed GST billing.
Supplier/recipient eligibility, statutory place/time-of-supply rules, explicit
commercial-price reconciliation, tax-aware accepted snapshots and native invoice
tax allocations remain separate required increments. Statutory issuance remains
P13C. A jurisdiction variant entered here is reviewed evidence, not a conclusion
derived by comparing addresses.

## Usage on staging

1. Configure the issuing company's registration and map it to the quotation's
   existing office. The office/company/registration must be active.
2. Record an explicit tax identity on the quotation's saved main customer: a
   canonical person or business. Missing details never mean unregistered, and a
   business does not inherit its representative's or linked person's identity.
3. Publish enabled company profiles with current reviewed rates. Rate changes,
   inactive directory entries or stale profile versions require fresh review.
4. Save the quotation and open its **Tax preparation** tab. Only the current
   revision, which has never been ordered, can receive prepared inputs.
5. Enter the proposed supply date, select the saved customer's reviewed identity
   and choose a profile/variant for every line. Enter each line's India
   state/territory code and reviewed place-of-supply basis. The date checks
   registration validity; it does not determine the statutory time of supply.
6. Confirm the review and choose **Save reviewed tax inputs**. Copies of the
   registration, recipient identity and profile versions become immutable.

Correcting prepared inputs requires a new quotation revision. Preparing them does
not increment the quotation's ordinary version or overwrite an editor draft.
An already ordered revision, including a cancelled order's original revision,
cannot be annotated afterwards. Saved revisions lacking an explicit main-party
reference must be replaced by a new revision rather than borrowing the
opportunity's current contact. A later opportunity contact/account change never
substitutes another party for an existing quotation's saved main customer.

Stale mappings, identities and profiles return conflicts. Draft fields remain;
**Reload saved preparation (discard draft)** explicitly refreshes the source.
Choice requests cannot restore an older selection response after a refresh.
Selectors page/search/count and resolve selected labels through the same source
company or saved main-party population.

## Price illustrations and documents

Plain lines without commercial discounts or charges can show a calculation
illustration using the frozen profile snapshots and immutable quoted line values.
Any difference from the saved commercial amount is shown; nothing is repriced or
accepted. Discount/charge-bearing quotations omit this illustration until their
adjustments receive explicit pricing/tax classification. A charge called GST is
never silently reclassified or taxed again. Multiple lines can retain different
profiles and explicit supply evidence.

Commercial quotation rendering and existing PDF archives are unchanged. Prepared
inputs do not turn a quotation, receipt or commercial invoice into a GST document.
KYC uploads, signatures and ownership calculations remain outside this increment.

## Authorization and database contract

Preparation uses the existing tax-administration boundary: actual Tenant Admin,
tax-configuration Read and the source quotation's Read/Edit scope. Staff/Manager
labels and broad custom profiles do not confer tax administration. Ordinary
authorized quotation readers can read saved evidence without gaining current
master-directory access. Restricted sharing, office ancestry, tenant boundaries,
current user/profile authority and CRM/Sales Documents activation still apply.

Writes refresh authority after the tenant security lock and lock the quotation
header. Native checks bind its current revision, original office/company,
versioned office mapping, effective issuer/recipient revisions, saved main party,
current enabled company profiles and every source line. Master snapshots must
equal their immutable history. Selected registrations/profiles/rates are protected
while captured. Strict source audit writes share the same transaction; audit
failure rolls back the complete review graph.

Migration `20261030000800_quotation_tax_inputs` adds two empty forced-RLS source
tables. Typed composite foreign keys and immutable rows retain the source and
master-version relationships. Deferred proof requires exactly one reviewed row
for every source line. An additional order-insert guard shares the quotation lock
with preparation, so concurrent preparation/order creation has one winner.
Previously stored functions, policies, triggers and business values remain;
the new guard intentionally blocks only prepared revisions.

## Verification

`npm.cmd run test:tax-inputs` uses a disposable localhost database. After a build,
append `-- --browser-only` for the preparation flow. Native checks cover people
and businesses, changed opportunity contacts, immutable/versioned master facts,
wrong recipients, stale mappings, missing lines, Restricted/tenant denial, native
proofs, acceptance races and strict audit rollback. Existing commercial invoice,
credit, payment, PDF and partial-billing regressions remain included.

The corrected deferred proof was rechecked on a newly created database; no
failed migration checksum or hosted history was rewritten to bypass validation.
Forced rollback and exact prior row/policy/function preservation are verified,
including retention of the old triggers beside the new acceptance guard.

## Verified staging release - 2026-10-31

Runtime `06378a2` is READY on all four staging aliases, deployment
`dpl_DiKpJYtqUvMhyvL3RTAZ9Aso2F7H`. Migration history is 144. All 46
unit/native/financial checks, two browser flows, build and targeted lint passed.
Both local and hosted desktop/mobile screenshots were inspected.

Hosted QA captured the inputs through the UI on an isolated tenant. It verified
unchanged quotation snapshots/version, frozen inputs after master archival,
stale/duplicate rejection, foreign-tenant and cross-origin denial, and the order
acceptance gate. The QA office's prior registration mapping was restored;
temporary issuer/recipient records were archived, the profile disabled and its
rate made inactive. Immutable source evidence remains in the QA tenant.

The staging cutover preserved exact values in all 154 prior tables, policies and
stored functions. Its encrypted archive passed decryption/hash and restore-list
verification, not a full restore rehearsal. A checksum gate rejected an obsolete
operator before any DDL; the refreshed operator then applied the tested SQL.
No hosted migration history was rewritten. The owned localhost fixture was
removed after verification. Production aliases, GitHub main and the root Vercel
production link remain unchanged; no Git push was performed for this increment.

Next is P13B3: explicit tax-aware pricing approval and accepted-source snapshots,
followed by native invoice tax allocations. These remain required before calling
this a complete GST billing workflow or releasing it to production.
