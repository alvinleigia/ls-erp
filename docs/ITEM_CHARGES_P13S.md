# Item charges (P13S)

## Behaviour

Sales Catalog items can carry up to ten default charges. This is shared pricing
functionality: PLC is a charge name used by Real Estate, while another business
can use handling, packaging or another commercial charge.

Open an item, edit **Item charges**, and enter a name, calculation, value and
treatment. Group and payment conditions are optional. Percentages use that
quotation line's rounded quantity × rate, before discount. Enter `8` for 8%.
A fixed amount applies once to the whole line, regardless of its quantity.

Selecting an item copies its price and charges into the quotation for review.
The user can change or remove those copied charges. **Refresh item price and
charges** explicitly copies the latest defaults again; it preserves the entered
quantity. Catalog edits do not reprice saved quotations, accepted orders or PDFs.
Saving quotation changes creates the normal immutable revision.

Included charges add to consideration and its instalment schedule. Extra charges
remain separate receivable lines with their saved payment conditions. Item
percentages never use another item's price. Existing document-wide charges keep
their existing Base/Consideration rules; do not enter the same PLC in both places.

Summaries, standard/custom quotation PDFs and downstream order documents use the
saved calculation. Partial billing keeps each item's extra charges on that item;
shared charges and discounts use cumulative minor-unit allocation weighted by
the item's base price plus included item charges. Fixed charges follow the billed
fraction of that accepted line. No money is collected by adding a charge.

GST pricing retains its existing explicit-classification guard: commercial charges
are not inferred to be tax, taxable supply lines or exempt amounts. A quotation
with unclassified item charges cannot receive tax pricing approval. Commercial
quotations/orders/receivables continue through the existing workflow.

## Import template v2

Both standard catalog and Property units templates append optional columns:

| Column | Value |
| --- | --- |
| charge_name | For example PLC |
| charge_calculation | PERCENT or FIXED |
| charge_value | Plain number; 8 means 8% |
| charge_treatment | INCLUDED or EXTRA |
| charge_due | Optional payment conditions |

Leave all five blank for no charge. If any is supplied, the first four are
required. One charge is supported per imported item; add more through its editor.
Server validation, correction downloads and exactly-once imports remain in place.
Download a fresh template. Version 1 saved imports remain read-only history;
remaining rows must be copied to the current template and uploaded again.

## Implementation and preservation

`platform/pricing` owns the bounded charge contract and editor. Catalog and
quotation lines reuse it. Real Estate contributes no pricing special case.
Catalog Read/Create/Edit and existing quotation permissions remain authoritative;
no new access grants, module activation or ownership changes are introduced.

Migration `20261119000500_item_charges` adds an empty JSON array to catalog rows,
a native validation check, template version 2, item-aware billing allocation and
the matching native tax guard. Existing item values, quote/order snapshots,
payments, access and import source history are preserved. Old line snapshots
without item charges retain their prior calculation shape and billing allocation.
Migration `20261119000600_item_charge_tax_guard` disambiguates the native guard's
source-line alias, preserving the already-applied local migration checksum.

Run `node scripts/test-sales-orders.cjs --item-charges --browser` against its
automatically created disposable local database. It exercises forced rollback,
row preservation, import, pricing, invoice and browser regressions. Hosted
deployment requires the normal controlled migration/release workflow.

## Verified locally - 2026-11-19

- Both migrations: forced rollback and exact preservation of all 183 prior tables,
  excluding only the new empty catalog field; local demo has 166 migrations.
- 87 selected unit/native checks passed, covering charge precision, source
  preservation, authorization, v1 history, imports, receivables, partial billing,
  existing invoices/credits and both application/native tax approval guards.
- A 1,000-row catalog import completed exactly once in bounded batches. The
  existing 1,000-row enquiry import regression also passed separately.
- Three browser flows passed item creation, property selection, Excel template/
  correction downloads, import, charge overrides/removal/refresh and PDF download.
  Desktop/mobile screenshots and the rendered PDF were inspected. The sample
  reconciles INR 1,000 + 8% (INR 80) = INR 1,080 with an explicit per-line basis.
- Production build/TypeScript, targeted ESLint and whitespace checks passed.
  No hosted deployment, live inventory entry or client-data mutation was made.

Evidence: `tmp/industry-release/ls-erp-sales-orders-d82d9782da27.log` and
`test-results/local-access` (ignored local test output).
