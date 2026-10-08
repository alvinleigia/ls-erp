# Enquiry imports — Phase 4

Entry: **CRM → Enquiries → Import enquiries**.

Use **Download CSV template** in the upload section to get an empty sheet with
the supported headings. It includes enabled-module fields and editable custom
fields, whose stable `scope.code` headings map automatically. Fill it in using
Excel or Google Sheets, keep the headings, format phone cells as Text, and save
as CSV UTF-8 before uploading. The download requires the same import permissions;
it contains no sample customer rows. No additional migration is needed.

1. Upload a UTF-8 CSV or XLSX (first worksheet only).
2. Check suggested field mappings. Choose defaults for salesperson, source, sales
   team and, when enabled, project/subproject. Validate before creating records.
3. Review Ready, Errors and Duplicates, then import the ready rows. Download the
   correction CSV, fix invalid rows/remove genuine duplicates, and upload it again.

## Rules

- Contact name plus email or international phone is required. Email is trimmed and
  lowercased; phone formatting is normalized. If either identifier matches another
  row or any existing contact in the same tenant (including archived/private
  contacts), the whole row is skipped. No updates, merging or contact reuse.
- The first occurrence of an identifier takes precedence within a file. Duplicate
  errors identify its row number, never disclose another user's private contact.
- New enquiries start as New. Blank titles become `Enquiry - Contact name`.
- Existing source, salesperson, team and project choices accept exact names or IDs
  (case-insensitive); projects also accept codes, salespeople also accept emails.
  Unknown/ambiguous choices are errors. Choices are not auto-created.
- Dates must be YYYY-MM-DD; Excel date cells are converted to that representation.
  Custom enquiry/shared sales fields use the existing typed field validation,
  visibility, team scope, required/default and active-option rules.
- Email syntax is checked; this does not verify mailbox ownership/deliverability or
  detect every plausible spelling mistake in a domain or person's name.
- Current file limits: 1,000 rows, 80 columns, 3 MB uploaded, 2 MB cell text,
  10,000 characters per cell; Excel ZIP expansion is limited to 20 MB/500 parts.
  Malformed files are rejected before staging. Excel formula/error rows are returned
  for correction; formulas are never evaluated.
- Correction CSV contains original columns plus Import row, Import status and
  Import errors, and only unsuccessful rows. Formula-like CSV values are escaped
  as text. International phone numbers round-trip through that escaping.

## Implementation and access

- Imports require both `enquiries.create` and `contacts.create`, CRM enabled,
  current active tenant/user and the ordinary assignment permissions.
- Each import's source rows, mapping, progress and correction download are private
  to its creator in that tenant. Shared ERP sections, dropdowns, data table and
  centered pagination are reused. History and results are paginated on the server.
- `CrmEnquiryImport` / `CrmEnquiryImportRow` stage data and retain history, with
  forced tenant RLS, tenant-qualified foreign keys and indexes for creator/history,
  status/row and email/phone duplicate checks. Existing-contact checks use indexed
  tenant/phone and tenant/lower(email) predicates.
- Five rows per processing request; each row has its own serializable transaction.
  The enquiry/contact, extension fields, audit events and imported-row marker
  commit together. Retrying a completed row cannot create it again.
- Validation reuses the enquiry schema, permissions, assignment/team logic,
  extension validators and custom-field validators without creating CRM records.
  Commit revalidates current settings. Unexpected database/network failures pause
  processing rather than mislabel customer data as invalid.
- Reopen an import to resume it after interruption; no separate worker is required.
  Files are parsed in memory, then only staged cell values are stored. The original
  binary is not uploaded to object storage. Excel parsing is loaded only for uploads.
- Migration: `20261006100000_enquiry_import`. No existing lead/contact changes.

## Verification

Local disposable database, RLS runtime role:

```powershell
$env:CRM_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55440/ls_salon_crm_test'
node --require ./tests/register.cjs --test --test-force-exit tests/crm-import.integration.test.cjs
node --require ./tests/register.cjs --test --test-force-exit tests/crm.integration.test.cjs tests/custom-fields.integration.test.cjs tests/real-estate.integration.test.cjs
npm.cmd run build
node node_modules/@playwright/test/cli.js test tests/local-access/enquiry-import.spec.ts --config=playwright.local-access.config.ts
```

Import coverage includes CSV/XLSX parsing, mixed success, within-file/existing
duplicates, tenant/creator isolation, permissions/module gating, concurrent retry,
read-only preview, correction download/reupload, typed custom fields, disabled
extensions and atomic rollback when a new required field is introduced after preview.
Browser coverage uses only isolated local fixture data; desktop/mobile screenshots
are inspected. No hosted customer records are created during verification.

Release verification (2026-10-06): 12 import integration checks, 71 CRM regression
checks and 33 custom-field/property regression checks passed; four legacy
migration-only tests were skipped because the disposable database was already
migrated. Production build, targeted lint and the local browser workflow passed.
The additive migration was applied to the configured production database; both
new tables have forced RLS and the runtime role's required table privileges.
