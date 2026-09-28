# Configurable CRM activity types

Managers configure types at **CRM → Activity types → New activity type**.
For example, enter **Site Visit**, choose **Meeting** behaviour, and optionally
provide default instructions. Staff select the type when scheduling, logging an
interaction or arranging a manual follow-up. No business-specific defaults are
automatically created.

## Behaviour and history

- Task, Call, Meeting and Email remain available. Custom types inherit the chosen
  behaviour's outcomes and controls. Scheduling and reminders retain existing rules.
- The behaviour is fixed after creation. Names and default instructions can change;
  archiving stops new selections while existing activities remain editable and
  completable. Activity names are snapshotted so historical labels survive renames.
- Instructions fill an empty preparation field when a type is selected. They do
  not replace staff-written instructions or change previously scheduled work.
- Plans and follow-up destinations support custom types. Archived choices block
  new plan launches; a blocked rule can be skipped with an audited reason.
- Rule triggers continue to match **base behaviour + outcome**, including custom
  types using that behaviour. There are no separate custom-type trigger overrides.
- My Work, embedded work lists, calendar and activity overview filter by custom
  type. Base behaviour filters include its custom types. Overview drill-downs
  retain the selected type; follow-up gaps still cover all activity types.
- Overview aggregates remain bounded to four base behaviours. Selecting a custom
  type reports its own totals and name. This avoids an unbounded catalog breakdown.

## Storage and queries

`CrmActivityType` is a tenant-owned, versioned catalog with forced RLS, normalized
unique names and no delete endpoint. `CrmTask` retains its existing behaviour enum
and adds a nullable catalog reference plus historical name. The composite foreign
key prevents cross-tenant references. The additive migration is
`20260928230000_crm_activity_types`.

Catalog searches use server-side pagination. Plan references are validated in a
batch; each generated activity is also validated in the same transaction. Work
lists select stored labels without adding catalog joins. Tenant/type/status/date
and tenant/type/completion indexes support filtering and reporting. Existing
assignment, visibility, reminder, completion and optimistic-lock checks remain.

## Verification

- Applied the actual incremental migration to a disposable local PostgreSQL 16
  database built from the previous schema. Hosted business data was not used as fixtures.
- CRM/sales/unit/history suite: 98 passed; two existing migration-fixture tests skipped.
- Authenticated HTTP test covers catalog permissions, creation, scheduling,
  filtering, overview totals, archiving and stale writes.
- Three browser tests cover configuration, staff read-only controls, scheduling
  defaults, custom/base filters and mobile fit. Desktop and mobile screenshots inspected.
- Production build and TypeScript pass. Targeted lint and whitespace checks run.
- With 20,000 synthetic activities and a non-bypass runtime role, both core query
  plans used the new indexes: list 1.641 ms; completed report 0.627 ms locally.
  These measurements do not predict hosted response times.

Repeat the query check only on the guarded disposable database:
`node tests/crm-activity-types.performance.cjs` with `CRM_TEST_DATABASE_URL` set to
localhost and database `ls_salon_crm_test`. Never run fixture or reset scripts on
the configured hosted database.
