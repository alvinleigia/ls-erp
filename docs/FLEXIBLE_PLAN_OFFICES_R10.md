# Flexible weekly and recurring plan offices — R10 phase 2D4B3B1

Local, unreleased. This slice covers weekly plans and recurring patterns, not
daily flexible slots or daily overrides. Those follow in phase 2D4B3B2.

## Ownership and authorization

Weekly plans and recurring patterns have required, immutable tenant and office
ownership. Days, weeks, slots and breaks inherit that boundary through their
parent. Weekly operations use `shiftRoster`; recurring operations use
`shiftPlans`. Current Read, the requested action, module activation, tenant
identity and office access remain independent requirements. Role labels and
employee/team memberships do not confer actions.

New forms capture the workspace office and version when opened. Creates and
clones validate that snapshot inside the locked scheduling transaction. A stale
form returns a conflict; it never silently switches offices. Edits retain the
source office regardless of the current creation preference. The recurring list,
detail and roster editor display protected source-office labels without needing
directory administration permission. Closed offices retain Read but reject writes.

New plans, clones, expanded windows and reactivations require an active Flexible
staff profile, office eligibility and a dated workplace interval covering the
whole plan. Open-ended patterns require ongoing placement. Unplaced employees
receive no invented workplace. Unchanged or narrowed existing plans can be
maintained after employee membership revocation without moving their source or
changing their anchors. The actor still needs current source-office authority.

Creating an inactive draft requires Create. Changing an existing active state or
displacing another active pattern requires Archive in addition to the owning
operation. Create-only users can insert children of their newly created pattern;
they cannot edit existing roots or children. Hidden cross-office overlaps produce
an opaque conflict and cannot be silently deactivated. A weekly collision outside
the operation also fails without substituting a different record.

Database restrictive RLS protects both roots, all seven descendant tables and
office-tagged audit copies. Triggers enforce immutable identities, fresh operation
permissions, office authority and workplace coverage. Ancestry and coverage
helpers are private; protected public helpers disclose only bounded labels or
booleans. Required auditing remains in the same transaction as source changes.

Cloning records a source-office read event and a separate destination creation,
linked by request ID. Destination history starts with a null `before`; neither
office's audit contains the other office's record or employee identity.

## Effective time and history

Canonical Flexible selection matches weekly/recurring source ownership to the
employee's dated workplace. Protected effective-time consumers still see working
hours when ordinary source Read is denied. Their timing-only output does not
reveal source IDs, offices or labels. A protected mode-change conflict check sees
hidden active/future plans; source RLS cannot make those plans disappear.

Existing frozen history is unchanged. Daily-slot fallback and daily overrides
retain their preceding contract until the next slice; this is not a claim that
all operational ownership is complete. Bulk skip-weekoff selection, remaining
selectors, appointments and operational release checks remain prerequisites.

## Migration and verification

Migration `20261026001200_flexible_plan_offices` places preexisting roots once in
their tenant's initial office and tags corresponding audit copies. There is no
runtime initial-office fallback or tenant-specific adapter. The rehearsal tests
forced rollback and preservation of all 128 preceding tables except the explicit
root/audit ownership additions. IDs, date anchors, timestamps, slots, breaks,
frozen history, private leave evidence and grants are compared unchanged.
Seven nested tenant policies now use a bounded private ancestry lookup to avoid
repeated parent RLS expansion. Their tenant checks remain separate from the new
restrictive office policies. Unrelated policies are compared unchanged; rollback
restores the original policies exactly.

Old regression fixtures use a disposable test-only insertion helper. Native
ownership tests assert that helper is absent. It is not part of the migration.

Commands:

- `npm.cmd run test:flexible-plan-offices`
- `npm.cmd run test:availability-boundary`
- `npm.cmd run build`
- After building, `npm.cmd run test:flexible-plan-offices:browser`

All automated fixtures run locally against a disposable database. Browser tests
use real Chrome and synthetic tenant accounts. They are not a restored-client
upgrade or hosted deployment verification. No client data is modified.

The final focused run passed all 91 checks with no skips, including disabled
module, direct Read-only child writes, captured context, immutable ownership,
workplace coverage, private overlaps, audit isolation/rollback and historical
booking behavior. Evidence: `tmp/industry-release/ls-erp-sales-orders-37159c1fe35f.log`.

All 176 broader workforce/appointment regressions passed without skips. The full
twelve-week save/clone case completed in 3.6 seconds with bounded bulk inserts.
Evidence: `tmp/industry-release/ls-erp-sales-orders-b5c7c4fe0d15.log`.

The real Chrome workflow passed: captured stale-office draft rejection with fields
retained, successful new-office creation, source labels, scoped list/detail Read,
and cross-office cloning/audit privacy. Form and scoped-list screenshots were
inspected. Evidence: `tmp/industry-release/ls-erp-sales-orders-8385902a7e8a.log`.
Application build/TypeScript, changed-file lint and whitespace checks passed.
Nothing was pushed, migrated on a hosted database or deployed.
