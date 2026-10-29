# Quotation and payment-plan PDF layouts - P9

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
Deployment and hosted results are recorded after verification; production remains
outside this phase.
