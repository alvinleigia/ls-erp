# Shared document template editor - P8

Deployed and verified on staging on 2026-10-29 from `6030380`.
Deployment `dpl_FaXavAweiB3GzDnyMmcMeiUeWUsj` is READY on all four staging
aliases. Production and GitHub main remain at `4546cb2`; all three production
aliases are unchanged. No migration, environment change or production write.

## Scope and usage

Settings > Company document templates retains the issuing-company and document
type selection, reviewed company wording, logo choice and explicit enablement.
Its new Document layout editor supports paragraphs, headings, bold/italic text,
left/centre/right alignment, dynamic field chips, source sections and page breaks.
Use Insert field to choose an approved value rather than typing a tag. Use the
starter layout to begin again; replacement requires confirmation.

An administrator can download a draft sample PDF before publication. Samples
contain explicit example customers and amounts, not live customer records.
Actual rows and pagination depend on the order; prepare its document to review
the actual customer, financial and property evidence before issuance.

Publishing creates a new immutable company/type version, with the existing
review acknowledgement and optimistic version check. Actual Tenant Admin
authority is required for both publication and sample preview. Delegated template
Read permits viewing published templates, not publication or sample generation.
Staff use published templates through their existing source/document permissions.

This increment applies the editor to existing order acknowledgements, booking
intimation and unit allotment letters. Their payment schedules are repeatable
tables populated from accepted commercial terms; financial positions remain
independently authorized ledger projections. A booking acknowledgement is not a
payment receipt. A separate payment-receipt provider must bind a real posted
payment before receipt issuance is offered. Quotation PDFs retain their existing
renderer in this increment. Named template variants and arbitrary page designs
are not introduced by this editor foundation.

## Shared boundaries

- `platform/documents/layout.ts` defines a closed, bounded structured layout.
  Only registered scalar fields and section keys are accepted. Text is literal;
  no JavaScript, HTML execution, arbitrary URLs, formulas or property-path
  evaluation is supported. Unsupported pasted nodes/marks cannot be published.
- Source adapters provide field values and section populations. Sales Orders
  supplies accepted customer/order/money/bank facts; Real Estate registers its
  property/allotment sections. The shared editor and renderer import no industry
  implementation. Adding a field requires a catalog entry and an explicit value
  resolver, never a client-selected query or ORM property.
- Customer, line, schedule, charge and provider-specific financial/property
  sections must appear once in the layout. Missing source data yields no rows;
  it does not permit hiding existing source facts or recalculating amounts.
  Repeated participants retain their individual names and accepted roles.
- Reference, company identity, draft marking, issuer/signatory and page numbers
  remain controlled by the issuance engine. The existing source Read/Create/
  Export checks, office RLS, current modules, replacement chains, source
  fingerprint rechecks, strict audits and exact-file downloads remain mandatory.
- Accepted layouts resolve to literal formatted runs and source sections before
  rendering. The resolved body joins the immutable issued snapshot and its
  fingerprint. Later template/contact/payment edits cannot regenerate old files.
- Existing published templates without a custom layout continue their existing
  rendering until an administrator publishes a new version. Opening the editor
  supplies a starter layout without rewriting the stored template. Historical
  PDFs and original template versions are never changed. No schema migration,
  role grant, module enablement or client-data backfill is needed.

## Rendering

The existing server PDF engine renders the supported structure directly.
There is no browser HTML-to-PDF service or client-controlled remote rendering.
Noto Sans regular/bold/italic/bold-italic assets preserve supported characters;
the existing explicit unsupported-character error remains. All four fonts are
explicitly traced into template-preview and issued-document functions.
Existing table header repetition, oversized-cell splitting, 100-page and 512-KiB
prepared-payload limits remain. Layouts additionally have node/text bounds.

The editor uses pinned Tiptap core/React/StarterKit/TextAlign packages and our own
registered field/section nodes. No hosted editing service or paid variable/PDF
add-on is required. Layout editing does not change a booking, instalment schedule,
receipt, amount due, allocation or ownership.

## Verification

The final focused native suite passed 25 checks, including unknown-field/section
rejection, repeated customers, accepted amount rendering, sample preview without
publication/issuance/audit writes, foreign-company denial, actual administrator
authority, stale drafts and immutable issued body/files. Build/TypeScript,
targeted ESLint and PDF function font tracing passed. The rich sample and all
four pages of the generated booking/allotment PDFs were visually inspected.

The broader 142-case run passed 141 checks; its remaining failure was a new test
assertion that did not catch synchronous validation. That assertion was fixed
and the case passed in the focused suite above. An earlier fixture used an
invalid company code; a concurrent build also interrupted one finance transaction
at its existing timeout. The subsequent broad finance checks passed. No runtime
authorization, integrity rule or timeout was weakened to make tests pass.

Browser testing caught and corrected editing usability/state issues: Add
paragraph avoids replacing a selected source section, and read-only/busy changes
do not emit content updates or lock the untouched document selector. Eight
existing booking/participant browser scenarios passed before those final UI
fixes. All three final editor/issuance browser scenarios passed against the
completed production build: type switching, dynamic-field insertion, sample
download without publication, starter-replacement cancellation, reviewed
publication, reload, mobile overflow, stale preview and exact replacement files.
Desktop/mobile editor captures were inspected. The fixture explicitly enables
the modules required by the selected provider; menu transitions are awaited.

Hosted staging acceptance passed using only normal API/UI actions in the
existing synthetic QA tenants. A dedicated test company published a disabled
template at version 1. The sample preview did not publish a version; its PDF
resolved Customer name to Sample Customer and remained marked DRAFT. Reselecting
the company after a full reload recovered the saved field. Another tenant was
denied both template Read and sample preview; an unknown field was rejected
without changing the published version. Desktop/mobile captures and the actual
hosted sample PDF were inspected. No hosted booking, customer, payment or issued
PDF was created. The initial-attempt QA company was archived through its normal
API; the final test company remains available with issuance disabled.

Installed Chrome requests stalled in this test environment. The final hosted
run used bundled Chromium with its normal transport and real server responses,
without request mocks or a transport bridge. Source code is identical to the
verified local build; later test/documentation edits need no second deployment.
Private receipts, attempts and captures remain under ignored
`tmp/document-editor` and `tmp/industry-release`.

Run `npm.cmd run test:document-editor` for focused native coverage, adding
`-- --browser` after a completed production build for the editor/issuance browser
checks. Full surrounding coverage remains `npm.cmd run test:documents`.
