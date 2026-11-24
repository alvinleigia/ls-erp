# Standard catalog and property-unit imports (P13S)

## Workflow

Open **Sales Catalog > Products and units > Import items**. The same entry is
available from a project's Units tab. Choose Products and units or Property units,
download the Excel template, fill its **Items** sheet, upload and validate. There
is no field-mapping screen. The Instructions sheet documents each column.

Review Ready, Needs correction and Duplicate counts, then confirm **Import valid
rows**. Errors and duplicate rows are skipped. Download corrections, correct only
those rows and re-upload; trailing report columns are accepted and ignored.
Existing catalog records are never updated, merged or reactivated by an import.

Saved imports belong to their creator. A reload preserves the selected import;
Saved imports lists earlier attempts. Validation and import run in bounded batches
of up to 25 rows, with a request time budget. Pause finishes the current batch.
An uncertain network response is recoverable by reopening and resuming. Item
creation, strict catalog audit and the imported-row marker commit together.
Concurrent/repeated processing cannot import the same row twice.

## Template v3

Common required fields: `kind`, `sales_unit`, `availability`.
`unit_price`, `currency` and `description` are optional. The general catalog additionally
requires `item_code` and `item_name`. For property units, `unit_code` is an optional
unit code (case/punctuation preserved) and `item_name` an optional custom name.
The internal reference is generated automatically.

- General catalog codes are unique within this business and normalized to
  uppercase. Property unit codes retain their case/punctuation and are unique
  within the selected physical project/building; other buildings can repeat them.
- PRODUCT is repeatable stock; UNIT identifies one particular unit.
- Price is the amount for one sales unit, not an area-based rate. Numbers use
  decimal points, without grouping separators/currency signs, up to four decimals.
  Blank prices mean **Price not set** and remain null in storage. Explicit zero is
  reserved for intentionally free stock. Blank currencies use the business currency
  in Settings, captured once as immutable import metadata when the file is uploaded.
  Explicit currency overrides remain supported. Later setting changes never reprice
  items or change a reviewed import. Missing business settings require setup before
  uploading a file with blank currencies.
- Availability must be explicit: AVAILABLE, UNAVAILABLE, SOLD (UNIT only). Existing
  booking/hold status without a migrated agreement should be UNAVAILABLE. Import
  does not create reservations, customers, orders, ownership or payments.
- Five optional charge columns follow the profile fields: `charge_name`,
  `charge_calculation`, `charge_value`, `charge_treatment`, `charge_due`.
  For PLC use PLC / PERCENT / 8 / INCLUDED (8 means 8%). Defaults are copied
  into quotation lines for review. See ITEM_CHARGES_P13S.md for pricing rules.
  Earlier version 1 and 2 imports remain read-only history; use a fresh template for
  remaining rows.

Property units require `project_code`, `property_category` and `unit_number`.
Optional fields: `floor`, `launch_phase_code`, `area`, `area_unit`, `bedrooms`.
Unit number and optional unit code are unique within the physical project or
building, independent of launch phase. Different buildings may repeat a number. Category uses its exact
active name. Project and phase use existing codes; names are not guessed and
setup records are not automatically created. Area needs SQ_M or SQ_FT when set.
The project may be at any hierarchy depth. Its root determines company/office and
access. Launch phase must belong to that same root; planned/paused/future phases
keep new reservations gated after import. Blank phase means unphased stock.

Only our template is accepted. Preserve headings and order. Up to 1,000 data rows,
3 MiB, CSV UTF-8 or XLSX first worksheet. Formulas and Excel errors require
correction; ZIP expansion and cell/text/column limits apply. Templates contain no
sample inventory rows. Excel dropdowns are guidance; server validation is decisive.

Selecting an item with no catalog price leaves the quotation rate blank. Staff
must enter the agreed rate before saving. Updating catalog prices later never
reprices saved quotations or orders. Existing zero prices remain explicit zero.

Optional-pricing migration and final local verification (2026-11-21): 183 preceding
tables preserved, forced rollback verified, 27 native/unit checks and three Chrome
flows passed. Local demo migrated to 168 without business data changes. Evidence:
`tmp/catalog-optional-pricing-native.log`, `tmp/catalog-optional-pricing-build.log`,
`tmp/catalog-optional-pricing-local-migrate.log`. Hosted environments unchanged.

## Ownership and implementation

Shared bounded file parsing/CSV escaping live in `platform/imports`, reused by
CRM enquiry import. Catalog owns template columns, private staging/progress,
duplicates and catalog creation. Real Estate contributes its profile, code
resolution and existing project/category/phase validation through application
composition. The catalog engine does not import a business addon.

Import needs current catalog Read/Create. Property templates additionally require
Real Estate activation, projects Read/Edit and canonical source access. Each batch
reauthorizes under the tenant operational lock; each row is checked again before
creation. Resolved source identities are bound at validation and compared at import
so renamed/reused setup codes cannot silently redirect units. Native catalog,
project, office, sharing and launch guards remain in force. Unexpected storage or
audit/database failures roll back the batch; they are not mislabeled bad rows.

Migration `20261119000400_catalog_import` adds empty creator-private import and row
tables with forced tenant RLS, same-tenant references, immutable source/history and
completed-row guards. It does not change existing inventory, access profiles,
company ownership, module activation, reservations or commercial documents.

Run `npm.cmd run test:catalog-import` for the disposable migration/native checks;
append `-- --browser` for the real local browser walkthrough.

Production release is deferred until the user is ready for the units-import
release. Ewissen's workbook is reference only; no client data is imported.

## Verification - 2026-11-19

- Additive migration: forced rollback and all 181 preceding tables preserved.
- 8 import integration checks plus 4 ownership-contract checks passed. A stronger
  changed-code test also passed with a replacement project reusing the old code.
- All 43 preceding catalog, enquiry-import, launch-phase and reservation checks
  passed after extracting shared parsing and catalog mutations.
- 1,000 rows validated/imported exactly once in compact, bounded batches;
  concurrent calls, replay, source changes and audit failure were covered.
- Two production-build local browser flows passed. Final desktop/mobile images
  were inspected, including readable row errors and inline help alignment.
- Build/TypeScript, targeted ESLint and whitespace checks passed. Local demo has
  164 migrations; no hosted database or deployment was changed.
- Evidence: tmp/catalog-import-native-final.log,
  tmp/catalog-import-browser-final.log,
  tmp/industry-release/ls-erp-sales-orders-6ca65d6d6497.log (43 prior tests passed;
  its first new-file attempt failed on a test-helper name, corrected and rerun),
  and test-results/local-access/catalog-import-standard-un-e6c55-reload-and-confirmed-import/.
