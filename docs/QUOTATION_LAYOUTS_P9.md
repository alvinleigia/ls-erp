# Quotation and payment-plan PDF layouts - P9

Deployed and verified on staging on 2026-10-29 from `014bf50`.
Deployment `dpl_5A5WvBsNZbTVJEqfCnE2s9cnvfrA` is READY on all four staging
aliases. Production and GitHub main remain at `4546cb2`; all three production
aliases are unchanged. No migration, environment change or production write.

## Usage

Open a quotation or a named quotation template, select **PDF layout**, then
**Edit**. Enable **Use a custom PDF layout** to start with its source sections.
Add paragraphs/headings, formatting, approved dynamic fields or page breaks.
Download a layout sample to check the design using explicit example data.

Save a template to reuse the design through the existing explicit **Apply
template** action. Save a quotation as a new version, then use **Preview saved
draft** to review its actual customer, amounts, schedule, logo and registration
QR. **Issue & Download** archives that version's exact PDF. Later downloads reuse
the archived file. Applying or editing a named template cannot alter an existing
quotation revision or issued file.

Turning the custom layout off requires confirmation; saving creates a new version
with the standard PDF design. Existing standard quotations retain their renderer
and design until explicitly changed. Sample preview never saves the draft.
The editor controls fit narrow edit panels; fixed-choice menus scroll within the
available viewport so longer field catalogs remain usable.

This is a quotation/payment-instruction layout, not a payment receipt. It never
records a payment, calculates ownership or changes the ledger. Receipt issuance
must separately bind an actual posted payment. Company booking/allotment letters
continue using their own reviewed company templates and source adapters.

## Source and permission boundaries

- The optional layout is part of validated quotation content, named templates and
  immutable revision snapshots; no schema migration or fallback store is added.
- The source adapter uses only the selected revision's snapshot and immutable
  metadata. It does not fetch current customers, companies, catalogue prices or
  ledger balances. Snapshot branding uses its existing private asset reference.
- Customer identities, references, commercial lines, pricing totals, charges,
  schedules, bank details, terms and registration are required section slots.
  Existing facts cannot be hidden by deleting a section; absent facts render no
  rows. Totals and pending-charge notices remain source-owned. The payment-receipt
  warning remains outside editable layout content.
- Approved scalar fields have explicit resolvers. No arbitrary property paths,
  HTML, scripts, expressions, external images or field-driven queries are used.
  Existing document-size/page limits and font checks remain enforced. QR content
  is a bounded saved HTTP(S) registration URL encoded locally, never fetched.
- Editing/saving follows current quotation/template Create/Edit and record/office
  access. Read is required by the shared permission resolver. The sample endpoint
  accepts only a validated layout and checks fresh Sales Documents activation and
  a current corresponding Create/Edit grant. Its facts are always synthetic.
  It cannot preview a client-supplied customer ID. Payment Plans activation
  controls the sample schedule; existing actual schedule-write locks remain.
- Existing source Read/Export and fresh issuance checks, exact-file storage,
  optimistic versioning, strict audit, module guards and tenant/office isolation
  are unchanged. Quotation design rights do not grant company-template publication.

## Verification

All 50 focused native tests passed, covering layout validation/calculation
preservation, real PDF rendering, immutable revision/template and exact-file
issuance behaviour, module and action denial. All four local browser cases
passed against the final build: quotation edit/sample/save/reset/mobile flow and
three existing company-document/editor/issuance regressions. The initial browser
fixture omitted a required expected-close date; the final fixture supplies it.
The long-field menu exposed a real viewport overflow and was fixed before the
final browser pass. Reset confirmation deliberately retains the checked state
until confirmation, so its test uses click rather than an immediate-state uncheck.

Production build/TypeScript, targeted lint, whitespace and all four font-face
traces for sample/PDF/issuance passed. Generated PDF pages and desktop/mobile
captures were inspected. The owned disposable localhost fixture was removed.
Hosted QA used ordinary APIs and bundled Chromium with normal HTTP transport,
without SQL, seeds, resets or network mocks. A dedicated synthetic named template
was applied to a QA quotation; sample preview made no save, version 2 retained
its custom field/layout after reload, version 1 and prices stayed unchanged, and
the actual saved PDF resolved the QA customer and saved schedule. Cross-tenant
quotation/template access, unknown fields, extra customer IDs and cross-origin
sample requests were denied. No page errors or desktop/mobile overflow occurred.
The synthetic named template was archived after verification; the clearly named
QA source/quotation remain in the isolated staging tenant. No hosted PDF was
issued; real rendering plus exact-file issuance were verified in the native
storage-adapter tests. Hosted PDF pages and captures were visually inspected.
