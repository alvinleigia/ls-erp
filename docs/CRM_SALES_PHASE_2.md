# CRM and sales Phase 2: practical lead intake

Implemented and verified locally on 2026-09-28. Not deployed to the hosted CRM.
Phase 3 (optional Projects) has not started.

## Delivered

- Shared contact fields: optional alternate phone, WhatsApp number, address lines,
  city, region, postal code and country. Uses the application's existing country
  name catalog. Same-as-phone copies the current value; later edits are independent.
- Enquiry intake supports an existing contact or a new contact in the same form.
  New contact, optional company link, enquiry, history and required audits commit
  together. Duplicate conflicts preserve the draft so staff can switch to a
  visible existing contact. Hidden duplicates still require manager assistance.
- Tenant-managed lead sources at `/crm/lead-sources`, with search, pagination,
  create, rename, archive/restore and optimistic version checks. ADMIN/MANAGER
  manage sources; STAFF can select and browse them.
- Optional buyer company, referring person OR company, and target-close date on
  enquiries. A buyer company must be linked to the selected contact; a newly
  created contact can be linked atomically to an accessible active company.
- Enquiry search now covers title, customer name, normalized phone (including
  alternate/WhatsApp) and buyer company. Source and salesperson filters combine
  with existing status/search/pagination and assignment visibility.
- Created/updated/assignment information uses persisted timestamps and attributed
  history. New assignments have their own history event. Missing historical
  actors are shown as unavailable, never inferred from the current owner.
- Conversion prefills company and target-close date, requires a date when absent,
  and permits the salesperson to adjust the expected close date. It copies source
  and referral attribution in the existing atomic conversion transaction. The UI
  submits the reviewed enquiry version; a stale first conversion is rejected.
  Retries return the already-converted opportunity without overwriting it.
- Forms reuse shared sections, dropdowns, searchable selectors, save/cancel
  actions and pagination. No industry-specific CRM fork or configuration engine.

## Permission and compatibility details

Referral attribution does not grant access to a private referring contact or
company. Enquiry/opportunity responses mask inaccessible referrer IDs and names;
the form preserves that context without showing edit controls. Conversion can
carry the stored attribution without disclosing it to the assignee.

Primary contact email/phone uniqueness remains unchanged. Additional numbers are
communication fields, not identity keys. Existing contact owner/edit restrictions,
tenant RLS, enquiry assignment and work access remain in force.

Omitted new fields are preserved on updates from older callers. Explicit blank
values clear editable optional fields. New UI calls use source IDs. For legacy
text-source callers, existing active labels resolve to managed choices; managers
may introduce a new text label, but staff must select an existing choice. Retired
sources remain attached to existing records and can survive unrelated edits.
Renaming a source does not rewrite historical enquiry/opportunity source labels.

## Migration and release

Migration: `prisma/migrations/20260928120000_crm_lead_intake/migration.sql`.

It adds nullable contact and sales fields plus `CrmLeadSource`, tenant-scoped
foreign keys, source uniqueness, referral exclusivity checks and forced tenant
RLS. The backfill groups source labels by normalized spelling/spacing within each
tenant, preserves each enquiry's original source text/version/dates, and attributes
already-converted opportunities. A blank source remains blank. This is not a
legacy-client data import and does not merge contacts.

Deployment must apply the migration before serving the new application code and
generate the matching Prisma client. Follow the normal configured-environment
release process; no hosted migration, push or deployment was performed here.
The read-only migration verification suite now includes the new table and its
relationships. It must run after deployment against the intended runtime role.

Pre-release smoke: open an existing contact/enquiry, create a source as manager,
try staff source management (denied), create an enquiry with a new contact, select
an existing contact for a second enquiry, filter by company/phone/source, and
convert with company/date/source retained. Recheck a private referral after staff
handoff. Historical source names must remain unchanged after rename/archive.

## Verification

| Check | Result |
|---|---|
| `npm.cmd run test:crm` | 19 passed |
| Integration suite on a fresh disposable local Postgres database | 63 passed, 1 skipped; 64 total |
| Real additive migration from the pre-intake schema + synthetic legacy fixture | Passed, including source grouping, tenant separation, date/version preservation and already-converted opportunity attribution |
| Existing contact-layout and CRM control browser regressions | 11 passed with intercepted data/writes |
| New `tests/browser/crm-intake.spec.ts` | 6 passed with intercepted data/writes |
| Real local UI/API/database flow | Passed: new contact, company association, enquiry, source selection, assignment metadata and conversion |
| TypeScript, targeted ESLint and production build | Passed |

The integration skip is the older activity-upgrade fixture case, which is separate
from this phase's lead-intake migration. The new intake-upgrade fixture ran, not
skipped. No current hosted-data or deployment result is implied by these checks.

Visually inspected the generated desktop enquiry and narrow mobile intake/error
screenshots. The mobile draft survives a duplicate error and the form stays
within the viewport. Existing contact light/dark/mobile and read-only browser
checks also passed. Evidence remains in ignored `test-results/phase2-*` files;
authentication state remains separately ignored in `.playwright-auth`.

For repeatable upgrade testing, generate a pre-intake schema SQL file from the
revision before this migration, then point `CRM_TEST_BASE_SQL` to it and
`CRM_TEST_BASE_DATA_SQL` to `tests/fixtures/crm-intake-before.sql`. Set
`CRM_TEST_FROM_MIGRATION=20260928120000_crm_lead_intake` for the guarded local
preparer and `CRM_TEST_EXPECT_INTAKE_UPGRADE=1` for the integration run. The target
must be an empty, disposable local database named `ls_salon_crm_test`.

## Remaining phases

Next is Phase 3: optional Real Estate enablement, CRM dependency and project /
subproject management. Linking projects and property requirements into sales is
Phase 4; expanded reporting/export is Phase 5; reviewed import and pilot are
Phase 6. Payments, bookings, documents, commissions and messaging remain deferred.
