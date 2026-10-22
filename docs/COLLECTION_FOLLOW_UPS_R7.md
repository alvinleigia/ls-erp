# R7.5 - Collection follow-ups

Receivables reuse Activities for owner assignment, due dates, reminders, calls,
outcomes and internal notes. The pending list sits beside the order balance;
Show all includes completed and cancelled work. Open an activity to edit it,
record an outcome or schedule its next step. This is industry-neutral.

## Rules

- Start from an explicitly opened receivable on a confirmed order with a positive
  outstanding balance. Existing Activities create/assign permissions apply.
- The activity uses that order's current opportunity and customer. The nullable
  collection association is immutable and has a tenant-composite foreign key.
  Manual and rule-generated next activities inherit the same association.
- Creation and collection-specific browsing require fresh Sales Orders,
  Receivables and Activities permissions, module dependencies and current
  ownership/managed-team record scope. Counts and rows share those checks.
- Activity assignment grants ordinary activity access, not access to the financial
  record. An assignee can record an outcome or note without financial permissions.
  Creating another collection activity still requires financial read access.
- Settling/cancelling the order stops creation of new collection follow-ups.
  Pending work remains for staff to close explicitly; history is never deleted.
  Disabling Receivables hides its panel and denies collection-specific requests,
  while existing Activities remain available through their own permissions.
- Activity creation, schedule/owner changes, completion and notes use the existing
  strict transactional activity events and domain audit. Failed audit rolls back
  the activity. Outcomes never change balances or imply receipt of money.
- No automatic emails, messages, payment gateway or accounting entries.

## Architecture and migration

Application composition supplies the collection-context policy to Activities.
Core CRM does not query financial tables; shared Receivables UI receives its
activity panel through an application-provided rendering slot. Real Estate is
not required. Existing activity editors and schedule controls are reused.

Migration `20261023000300_collection_follow_ups` adds only a nullable association,
index, composite foreign key and consistency trigger to CrmTask. Existing forced
RLS applies. It does not backfill activities, change financial records, permissions
or module flags. SQL rejects association replacement, mismatched customer/deal
and follow-up chains that drop/change the association.

## Verification

59 isolated sales/receivable integration tests and 41 architecture/access tests
pass, including assignment, linked next steps, notes, scope/role/module denials,
settled/cancelled rejection, forced RLS, immutable links and audit rollback.
Build, TypeScript and targeted lint pass. The allowlisted QA workflow lives in
`tests/staging-orders/collection-follow-ups.spec.ts`.

Staging migration 105 to 106 compared 22 existing tables before/after (excluding
only the new nullable column). All existing data matched; runtime RLS checks
passed. Private receipts are in `tmp/staging-setup/r75-*`.
Production is outside this release scope.

Verified on staging at `ed30240` (2026-10-23), deployment
`dpl_4Q5hk1n316HGHA6hfsueo99KKAhL`, on the main staging and both QA aliases.
All three hosted workflows passed: collection follow-ups, receivable overview,
and payments/reversals. The collection test schedules through the UI, completes
a call with a linked next step, adds a note, verifies assignee isolation and
settlement/module gates. Desktop and mobile form/panel screenshots were inspected;
there were no browser errors or page overflow.

Restricted staging runtime queries verified three linked activities, five events
and five matching audits for the QA tenant; missing/foreign tenant contexts saw
zero of each. The completed activity and pending next steps remain available in
the synthetic QA tenant for review. Production/main remain unchanged.
