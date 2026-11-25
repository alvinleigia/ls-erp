# Shared document layout columns (P13S)

## Use

In a document template's Content tab, place the cursor and choose **2 columns** or
**3 columns** in the formatting toolbar. Click a cell and enter ordinary wording,
headings or dynamic fields. Repeating sections can also be placed in cells.
Place the allocation table below the column row when it needs the full page.

Click inside an existing row to change its count. Reducing three columns to two
moves the third cell's content into the second. **Single column** unwraps the row
in reading order. No text or source sections are discarded. Add paragraph appends
a full-width paragraph after the layout. The normal undo/redo controls still apply.

Select a repeating section to choose compact labelled details, bold labels or
hide its table heading. Customer/applicant names are source content and stay
visible. In table mode, set the number of trailing columns to align right; for
receipt allocations, three aligns scheduled, paid and remaining amounts.
**Emphasise table headings** adds modest bold emphasis to that section's header
while keeping its data rows regular. It is opt-in; existing templates retain their
header weight. Header wrapping/alignment uses the selected font's actual metrics.

Under PDF style, **Use softer charcoal for bold text and headings** retains bold
fonts with a softer dark-grey ink. **Bold company name and signatory in the
sign-off** controls the two automatic sign-off lines. Both are optional per
template; existing templates retain their colours and sign-off weight.
**Signing space above signatory** reserves one to six blank lines between the
company name and signature caption. Default spacing preserves the existing gap.
The reserved space is included in pagination together with the sign-off/contact.

Preview before publication. The editor stacks cells on small screens for editing;
the PDF retains the selected column count. Long content continues on subsequent
pages, with repeating table headers and protected footer space. The content after
a row starts below its longest column. Layouts are not forced onto one page.

## Boundaries

- One to three equal columns per row; no nested grids, absolute positioning,
  arbitrary CSS, executable templates, new editor libraries or rendering service.
- The same bounded layout schema and renderer serve quotations, orders, receipts,
  commercial invoices/credits and statutory preparation templates.
- Required section and individual-field checks traverse every column. Unknown,
  duplicate or missing required sections still fail. Ambiguous single-unit fields
  still require a repeating section. Every accepted customer/unit/line is retained.
- Existing layouts keep their full-width drawing path. Old stored templates and
  archived issued PDFs are not rewritten. New presentation belongs to a reviewed
  template version, frozen with the issued document.
- Columns require no database migration. The separate pending receipt-details
  migration/application release remains required for new financial balance fields.
- Deploy the shared application before publishing any template with column nodes.
  The prepared Ewissen configuration is a private local draft, not a production
  template update or client transaction.

## Verification

Automated checks cover nested validation, resizing without loss, source facts,
multi-page independent columns, all shared providers, numeric alignment, title
ascent and letterhead body preservation. The isolated browser suite exercises
field insertion, changing counts, preview without publication, reviewed publish,
reload and mobile layout. See the P13S milestone for final results and evidence.
