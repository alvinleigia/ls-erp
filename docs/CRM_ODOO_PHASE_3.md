# Phase 3: reusable custom fields

Implemented locally on 2026-09-29. Not deployed. Phase 4 (sales teams and workflow
presets) remains separate work.

## Configuration and behavior

Open **CRM > Configuration > Custom fields**. Managers can create text, number,
date, Yes/No and single-select fields for:

- Enquiries only.
- Opportunities only.
- Enquiries and opportunities: one shared definition, copied on conversion.
- Projects, when Real Estate is enabled.

Fields support stable codes, names, help text, display order, defaults, required
rules, text/numeric limits, filtering, visibility, editing permissions and archive.
Configuration uses the standard CRM list/detail forms, header Save/Cancel,
sections, searchable selections and centered pagination. New select options must
be saved before they can be selected as the field's default.

Record editors show an Additional information section. Defaults apply only on
creation. Omitted values preserve existing data; explicit null clears an optional
value. Required rules apply to records created after the rule was enabled.
Unchanged historical values remain valid after limits tighten or options archive.
False and numeric zero are valid values, including for required fields.

Fields shared by enquiries and opportunities copy in the conversion transaction,
including hidden/archived values and saved field/option labels. Their required-rule
cohort retains the source enquiry's creation date. Opportunity-only defaults and
values are applied separately. Conversion rejects attempts to override shared
values; edit the source first or the resulting opportunity afterward. Enquiry-only
values stay on the source. The conversion form explains this distinction.

Record scope, code and type cannot be changed after creation. Archive a field and
create a replacement if its meaning changes. Historical fields/options are never
deleted by configuration. Saved labels are retained until the record value changes.

## Boundaries and storage

- `platform/custom-fields` owns shared validation, definition management, typed
  value handling, filters and batch exports.
- CRM and Real Estate register their own resource descriptors. Application
  composition selects the available resources; the shared engine has no concrete
  industry import. Core CRM remains usable without Real Estate.
- Values remain in three typed relational tables with tenant/record foreign keys,
  definition scope/type foreign keys, select-option foreign keys, type checks and
  forced tenant RLS. Existing domain columns and relationships stay intact.
- Only defaults are configuration JSON. Business values are text, decimal(24,6),
  date, boolean or option IDs. No executable expressions, scripts or arbitrary SQL.
- Field writes share the parent record's authorization, optimistic version,
  serializable transaction and required audit. Configuration rechecks the active
  actor, tenant and module in its transaction.
- Hidden fields are omitted from staff forms, details and exports and cannot be
  used as a filter. Read-only fields reject writes. Restricted required fields
  need defaults so staff creation remains possible.

Limits: 50 definitions per applicable record type, including archived definitions;
50 options per select field; 2,000 characters per text value; up to 18 whole-number
digits and six decimals. Definition/option bounds also bound form reads.

## Queries and exports

Ordinary lists do not load custom values. A selected custom-field filter is added
to the existing tenant/record predicate through an indexed relation. Text supports
whole-value case-insensitive equality; numbers/dates support equality or one-sided
ranges; Yes/No and selects support equality. Title search remains title search.
Text equality uses a fixed-width SHA-256 key to avoid oversized multibyte B-tree
entries. Other value types have tenant/field/value/record indexes.

Enquiry, opportunity and project CSV exports include visible custom fields, stable
codes in headers, saved option labels and the existing formula-escaping protection.
Values are fetched in one batch, not once per record. Existing 2,000-row export
limits remain; custom exports additionally cap the selection at 20,000 field cells.

Before choosing storage, a disposable PostgreSQL comparison over 100,000 values
measured 0.091 ms for indexed numeric equality versus 18.908 ms for an unindexed
JSON extraction scan. This compares the proposed designs, not all possible JSON
index strategies. A final 10,000-value application check used 13 queries for a
five-record page, 129 ms service time and 0.087 ms indexed SQL on the fresh test DB.
These are local measurements, not production latency guarantees.

## Migration and release

Migration: `20260929120000_crm_custom_fields`, after Phase 2's catalog migration.
It creates empty definitions/options/value tables and adds a nullable conversion
cohort column. Existing record IDs, versions, timestamps and relationships are not
rewritten. No fields are imposed on an existing business automatically.

Back up the target database, apply pending migrations, then deploy the application.
Verify existing test leads, conversion, project access, custom-field permissions
and exports on the hosted environment separately. Rollback can deploy the prior
application while retaining these additive tables; do not drop collected values.
No hosted database, records or deployment were changed during this phase.

## Verification

- Actual upgrade from the previous schema with existing enquiry/contact fixtures
  completed on an isolated local PostgreSQL database.
- Fresh-schema preparation and the same custom-field integration suite passed
  independently on a second disposable PostgreSQL database.
- 10 custom-field integration tests cover configuration/record permissions, RLS,
  tenant foreign keys, typed values, historical labels, prospective required rules,
  conversion, archive, concurrent edits, audit rollback, module gating, exports,
  query bounds and indexed plans.
- 25 unit/boundary tests; CRM integration 70 passed, 2 legacy-fixture checks skipped;
  sales/report integration 9 passed; Real Estate integration 23 passed, 2 historical
  fixture checks skipped. The core suite used Node's `--test-force-exit` after its
  existing runner retained a handle despite finishing its assertions.
- Six browser scenarios passed: existing configuration (desktop/mobile), existing
  property sales flow (desktop/mobile), custom-field configuration/conversion/filter
  and mobile single-select/project fields. New test fixture mistakes were corrected
  before rerunning. Relevant desktop and mobile screenshots were inspected.
- TypeScript, targeted ESLint, Git whitespace checks and the production build
  passed. The build needed network access for the existing Google Fonts. Prisma
  schema drift against the fresh database was empty. Disposable databases and
  the local development server were stopped after verification.

Regression testing also exposed adapter-pg unique-conflict metadata without key
details under RLS. CRM retry handling now recognizes the retained constraint name,
so concurrent enquiry conversion returns the existing authorized opportunity.
Both metadata formats and raw-query serialization conflicts have regression checks.
