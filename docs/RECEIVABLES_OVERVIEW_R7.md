# R7.4 - Receivables overview

The Sales Orders menu now includes Receivables when the module is active and the
user has both Sales Orders and Receivables read access. This industry-neutral
overview links to the existing order payment workflow.

## Rules

- Show only explicitly opened schedules on confirmed, currently accessible
  orders. Draft, cancelled and unopened orders are excluded.
- Search the saved order title, customer name or order reference. Filter by
  outstanding, overdue, settled or all balances, and by currency. Search text is
  literal, including percent and underscore characters.
- Compute current net receipts from posted payment allocations. Corrected and
  refunded entries no longer reduce the balance. Keep currency totals separate;
  no exchange conversion or combined currency total is inferred.
- Age unpaid amounts using the tenant's business date: not yet overdue, 1-30,
  31-60, 61-90 and 91+ days overdue. Unscheduled amounts have their own bucket.
  Today is not overdue; paid portions are excluded from ageing.
- Paginate and sort in the database. Totals represent all matching orders across
  pages. Numeric sorts use numeric values, not formatted strings. Orders without
  an unpaid due date sort last when ordering by due date.

The existing authorization transaction refreshes user status, tenant status,
module dependencies and custom-role permissions. Application composition supplies
the current opportunity ownership/team scope; the shared receivables module does
not import CRM or Real Estate. The same scoped database set powers rows, counts,
currency choices and aggregates. Receipt references and notes are not exposed by
this summary API.

No schema migration, backfill, balance mutation or automatic activation is needed.
Staging rollout only; production remains unchanged.

## Verification

Integration coverage checks ageing boundaries, partial allocation and reversal,
separate currencies, numeric sort, literal search, pagination totals, cancelled
and unopened exclusion, and fresh own/team/role/module access. Navigation tests
check both read permissions, activation and exact menu highlighting.

Hosted coverage is in `tests/staging-orders/overview.spec.ts`, restricted to the
existing allowlisted synthetic staging tenants. It checks filters, currency
totals, page totals, order navigation, scope changes, denied module/role access,
and desktop/mobile screenshots. Hosted verification is pending deployment.
