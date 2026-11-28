# Company quotation designs - P13S

Shared company quotation templates; no schema migration is required.

## Configure and use

1. Open Settings > Document templates. Select the issuing company and Quotation.
2. Edit the body with the existing editor, registered dynamic fields and repeating
   sections. Use PDF style and Printing for typography, colours, spacing and
   template-specific letterhead reservations. Preview, enable and publish.
3. New quotations inherit that company's enabled design. Commercial fields,
   prices, charges, bank instructions and instalments remain quotation data.
4. For a saved quotation, edit PDF layout and choose Load company design. Review
   and save a new version. This changes presentation without applying a commercial
   quotation template. Preview the saved draft before Issue & Download.

A later publication does not change earlier quotation revisions. Ordinary edits
retain the frozen design; loading a new company design is explicit. Stale or
newly disabled selections fail with a reload message. A disabled latest template
never falls back to an earlier enabled template. With no enabled design, existing
standard/custom quotation behavior remains available.

Issuance archives the digital bytes. Eligible letterhead copies derive from that
archive's marked branding layer, retaining source values, body and pagination.
Older archives without the printing marker remain available in their original
format. No extra stored PDF is required for the print copy.

## Architecture and access

Quotation registers a DocumentTypeInfo in the existing company-template registry.
Its catalog, editor, validation, provider sample and PDF renderer are shared with
other document types. No second editor or company design settings table is added.

The authorized opportunity's native issuing office resolves its company. Only
that company's latest enabled quotation template can supply the frozen design.
Publication retains administrator and documentTemplates permissions; using a
published design requires quotation creation/edit rights, not settings access.
Selected layout/appearance and resolved issuer/footer facts are snapshotted into
the new immutable quotation revision. Financial calculations are independent of
presentation. Commercial-content templates continue to be separate.

No schema migration, client-data rewrite, access-policy change or hosted test data
is required. Historical migration rehearsal fixtures isolate their older issuer
reader from today's application code; production has no compatibility fallback.

## Verification

- Optimized application build (including TypeScript) and changed-file lint pass.
- 72 automated checks pass: quotation rendering and saved revisions, company
  template publication, creator/publication permissions, stale and disabled
  designs, explicit design refresh/standard-layout selection, financial
  preservation, immutable issuance, letterhead derivation and order-document
  regressions. The native migration-preservation rehearsal also passed.
- Synthetic digital and letterhead PDF samples were rendered and visually
  inspected. Real client records and production settings were not modified.
- Nine local browser flows pass, including company quotation publication,
  applying the design to an existing quotation, saving/reopening the next
  revision, automatic defaults for new quotations, and existing mobile editor,
  order-letter and archived-print workflows. Relevant screenshots were reviewed.
