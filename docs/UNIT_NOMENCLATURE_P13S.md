# Unit numbers and company nomenclature (P13S)

## Approved Ewissen codes - production configuration, 2026-11-24

The user approved the proposed codes with **EGD** retained for Ewissen Greenfield.
These are tenant configuration values, not an application release or a naming
rule enforced on other businesses.

| Company | Code |
| --- | --- |
| Blockbuildtech LLP | BBT |
| Ewissen Infrastructure | EWI |
| Ewissen Greenfield | EGD |
| Ewissen Infra LLP (HR/payroll) | EIL |

| Project | Company | Code |
| --- | --- | --- |
| Altura | BBT | ALT |
| Deepwood harmony | BBT | DWH |
| Dodamarg Heights | BBT | DMH |
| Latex Valley | BBT | LTV |
| Shaashvat Aranya | EGD | SAR |
| Bliss abode | EWI | BAB |
| Bliss Aqua | EWI | BAQ |
| Bliss Farms | EWI | BFM |

The existing child project **Bliss Aqua Square / BAS** was outside the approved
list and was preserved. Office codes, launch phases and unit numbers/codes were
not renamed. Physical blocks are optional: use ALT-101 without a block, or
ALT-B01-101 only when an actual building/block exists. Keep launch phases separate.

The code-only production operation updated two company rows and eight project
rows, with ten audit entries. BBT and EGD were already correct. All original IDs,
names, company/office links, grants, profiles, sales, KYC, GST/document settings
and historical facts were preserved. An encrypted recovery copy was verified;
the full rollback rehearsal restored exact original data. Fingerprints across
all 184 public tables and security metadata allowed only the approved codes,
their version/update timestamps and the ten audit entries. Native guards were
restored within the same transaction; no schema, migration or app release changed.
There were no unfinished imports referencing the renamed project codes.
Private evidence: `tmp/ewissen-code-update/applied.json` and its referenced
encrypted recovery directory. Authenticated live APIs verified all four companies,
all nine project/child records and all three offices against the pre-update records;
only the approved codes and their update metadata changed. Company/project list
screenshots were inspected. Evidence: `tmp/ewissen-code-update/verified.json`,
`live-companies.png` and `live-projects.png` in the same private directory.

## Bliss Aqua sections and launch phases - production setup (2026-11-24)

Following the user's clarification and authorization, Bliss Aqua/BAQ now has
two physical child sections: existing Bliss Aqua Square/BAS and newly created
Bliss Aqua Triangle/BAT. Both use the same root company/office boundary. Four
root-owned launch phases exist: PH01-PH03 named Square - Phase 1/2/3, and PH04
named Triangle - Phase 4. All are Planned with no opening date until Ewissen
confirms booking releases. Phases remain root-owned; these names describe the
client's intended assignment, not a new child-specific phase constraint.

The revised client workbook assigns 132 plots in PH01-PH03 to BAS and 57 in PH04
to BAT. Optional unit references remain BAQ plus the original plot number,
independent of phase; actual unit_number values and leading zeros are unchanged.
Creating setup records did not import stock or move existing projects/sales.
Authenticated before/after checks preserved all original projects exactly, and
the live project section/phase screenshots were reviewed. Native application
writes retained normal authorization, lineage and domain auditing. Private
receipts: tmp/ewissen-phase-setup/receipt.json.

## Shared behavior

Each tenant keeps its own records and conventions. Project codes continue to be
entered using the company's existing convention; this change never renumbers a
project or infers a code from a company name.

Property units have three separate identifiers:

| Field | Purpose | Example |
| --- | --- | --- |
| Plot / apartment number | Actual number, retained as text | `01`, `101`, `G-01` |
| Unit code | Optional reference following the project's or business's convention | `aqua_01`, `Altura_A/101` |
| Internal reference | Stable catalog reference, generated when omitted | `ITM-…` |

The database record ID remains the relationship key. Unit codes keep their
case and punctuation. No automatic prefix, numbering-pattern engine or customer
workbook-specific mapping is introduced. Companies can use their own conventions
through entry or the standard import template.

Unit number and optional unit code must each be unique, ignoring case, within
the selected physical project/building/section. Different buildings can both have
apartment 101. Launch phase is a release schedule and never a second namespace
for the same physical unit. Add physical buildings/sections through the existing
project hierarchy where needed. Floor is the actual floor label, not floor count.

New property forms request the actual number; name and unit code are optional.
The generated name uses category and number. Lists and quotation selectors add
the full project path to avoid ambiguity. Search supports number, unit code,
name and project context. Generic products retain their existing SKU/code flow.
Very long paths stay complete in selection labels and saved references; the
copied quotation description is shortened with an ellipsis to fit its existing
300-character limit and remains editable.

Template v3 uses `unit_number` and optional `unit_code`/`floor` for property
units. `item_name` is optional. Internal references are generated only on actual
creation; validation creates no inventory. Duplicate/error rows remain in the
correction download. Earlier v1/v2 jobs remain read-only history. Standard product
templates retain required `item_code` and `item_name`.

The visible label is **Unit code**, and property imports use `unit_code` so a
project prefix is not confused with a legal company code. The stored
`companyCode` field and existing `property.company-code` document tag keep their
identities and values; this wording correction needs no database migration.
Saved imports with earlier headings remain downloadable read-only history;
remaining rows must use the current template before processing.

Migration `20261121000100_unit_nomenclature` adds nullable property fields and
copies each existing catalog code into its company-code field exactly. It never
guesses a unit number, parses an old name, changes a project, moves an office,
changes access, or rewrites a commercial snapshot. Existing internal codes stay
unchanged. Import match keys become an indexed array to support multiple scoped
identifiers while preserving older source rows and results.
Review existing units through their edit form to enter actual numbers. Imports
create new stock only; include an existing unit code when checking a row
against older stock whose actual number has not yet been recorded.

New quotations freeze human-readable identifiers and property facts alongside
existing internal references. Reservations still identify inventory by record
ID; their presentation uses saved order labels. Property documents can insert
unit number, unit code and floor individually or use the repeating section.
New prepared documents recheck accepted unit facts. Historical accepted evidence
is compared using the facts it actually captured. Issued PDF bytes stay archived
and are never regenerated from current catalog names or codes.

Verification: run `node scripts/test-sales-orders.cjs --unit-nomenclature --browser`.
The runner is restricted to disposable loopback databases and synthetic tenants.
It rehearses migration rollback/data preservation and tests imports, company
conventions, section-scoped duplicates, access, quotations, reservations, property
documents, existing orders/receivables, item charges and partial billing.

## Local verification - 2026-11-21

- Additive migration: forced late rollback and preservation of all 183 preceding
  tables, including staged import rows; existing codes copied exactly.
- 148 selected native/unit tests passed, plus two presentation/Unicode tests.
  Final focused catalog/presentation rerun: 13 passed.
- Three production-build browser flows passed: property import/corrections,
  unit creation/selection/quotation and existing reviewed item-charge behavior.
- Desktop/mobile screenshots and generated property PDF inspected. Final build,
  TypeScript, targeted lint and whitespace checks passed.
- Local demo has 167 migrations. Production/staging hosting remains unchanged.
- Evidence: `tmp/unit-nomenclature-native-browser.log`,
  `tmp/unit-nomenclature-focused-final.log`, `tmp/unit-nomenclature-build-final.log`.

Unit-code wording follow-up: 25 catalog/import/presentation checks and two
production-build Chrome flows passed on a disposable local database. The checks
cover current workbook headings, field-specific errors, previous-heading history,
1,000-row import, duplicate checks, preserved values, quotations and access.
Desktop/mobile screenshots inspected; build, TypeScript, targeted lint and
whitespace checks passed. Evidence: `tmp/unit-code-labels-native.log` and
`tmp/unit-code-labels-build.log`. No hosted changes or client workbook edits.
