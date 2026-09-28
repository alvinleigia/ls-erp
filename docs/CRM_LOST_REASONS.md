# Lost reasons

Managers configure shared reasons under **CRM > Lost reasons**. Add choices such
as Spam, Duplicate, Invalid contact details, Budget mismatch or Customer withdrew.
Staff can select reasons but cannot change the catalog. No default reasons are
inserted into business data automatically.

- Enquiry: select **Status > Lost**, choose a reason, optionally enter a closing
  note, then **Save enquiry**. Other statuses do not request a reason.
- Opportunity: select a stage whose outcome is **Lost**. The same reason dropdown
  appears in the editor and in the board's closing dialog. Closing notes are optional.
- Reopen an enquiry by choosing New, Contacted or Qualified and saving. Reopen an
  opportunity by moving it to an open stage. The current reason clears; audit and
  activity history remain. Closing it again requires a valid active reason.
- Enquiries and Opportunities expose a **Lost reason** filter, including archived
  choices. Their CSV exports include the reason and existing closing notes.
- **Sales reports > Filters > Lost reason** combines with source, salesperson and
  project filters. **Lead conversion > Lost enquiries by reason** groups lost
  enquiries from the creation-date cohort, with matching drill-downs and CSVs.
  Won/lost opportunity totals continue to use the closing-date period.

## Compatibility and isolation

Migration `20260928220000_crm_lost_reasons` is additive. It adds a tenant-owned
catalog with forced RLS, tenant-composite foreign keys and versioned changes.
Existing enquiry `CLOSED` values are presented as Lost; the internal enum remains
unchanged for compatibility. Existing `outcome` and opportunity `lossReason` text
are retained as closing notes. Historical closures without a structured reason
remain unclassified and can still be edited; they are never guessed to be spam.

Reasons cannot be removed from a classified lost record; select another active
reason or reopen it. Archiving stops new selections without changing records that
already use the reason. Renaming preserves the label recorded at closure.
Required audits run in the same transaction as catalog and record changes.

## Verification

Applied the migration to the previous schema in a disposable local PostgreSQL
database. The CRM, sales report and unit suites passed 94 checks (two older,
fixture-specific migration checks skipped). The authenticated HTTP workflow passed,
including catalog permissions and both closing paths. Browser tests exercise
conditional fields, optional notes, board closing, filtering and manager/staff
catalog controls; mobile and desktop screenshots were inspected.
Production build, TypeScript and targeted lint passed. The migration is applied
to the configured database; all six read-only deployment checks passed, including
forced RLS and fifty validated tenant-composite foreign keys.

Run `npm run test:crm:integration`, `npm run test:crm:sales:integration` and
`npm run test:crm` with the guarded local database setup described in
`MODULAR_PLATFORM.md`. Browser tests are in `tests/browser/lost-reasons.spec.ts`;
they intercept all business writes and can use the standard saved-session setup.
