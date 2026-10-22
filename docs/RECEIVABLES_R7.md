# R7.3 - Order receivables

Receivables is an optional, industry-neutral child of Sales Orders. Platform
allowance and tenant activation are both required. Existing tenants and custom
roles are not automatically changed. Work and deployment are staging-only.

## Workflow

- Confirm a Sales Order, then explicitly open its receivables. The immutable
  quotation revision supplies consideration, instalments and known extra charges.
  Pending charges block opening. The user confirms date-only due dates; blank
  dates remain unscheduled and are never counted as overdue.
- Record payments already received outside the application, in the order's
  currency. Partial payments cover the earliest due balances first, then
  unscheduled lines. Overpayments are rejected.
- Correct mistaken entries or record full refunds already paid externally. Both
  require a reason; refunds require a reference. Original receipts, allocations
  and reversal records are retained. A correction does not imply a cash refund.
- Resolve all posted receipts before cancelling the order. This protection
  remains active when Receivables is disabled. Cancelled orders retain history
  with no effective outstanding balance.

This increment does not transfer money, issue tax invoices, perform accounting,
support partial refunds or split a payment across orders. Schedule amendments
and cross-order credits are outside this increment.

## Access and ownership

`modules/receivables` owns balances, payment allocation and reversals. Application
composition reads the saved quotation format and supplies current opportunity
scope; the shared module imports no CRM or Real Estate implementation.

Every operation rechecks tenant/user state, activation, Sales Orders read access
and current record scope. `receivables.read/create` govern schedules;
`orderPayments.read/create/cancel` govern receipt history, recording and reversal.
Financial mutations additionally require ADMIN or MANAGER. Saved custom roles
receive no new permissions automatically. Financial audit rows are restricted
to administrators with the corresponding module/read permissions.

## Integrity and migration

Migration `20261023000200_order_receivables` adds five tables with forced RLS,
tenant/order composite foreign keys and immutable record guards. Deferred
constraints reconcile lines, receipts, allocations and reversals at commit.
Parent locks, serializable retries and ledger versions prevent competing payment
and cancellation writes. Request IDs make retries idempotent; reused IDs with
different contents are rejected. Active payment references are unique per
tenant/method without case differences. Mandatory audit failure rolls back the
whole transaction.

The staging migration advanced history from 104 to 105 and verified unchanged
row counts and content hashes across 15 existing tables. It does not backfill
receivables or change existing orders, role assignments or module flags.

## Verification

- `npm.cmd run test:sales-orders`: 50 isolated integration tests passed, including
  financial totals, partial allocation, duplicate/reference rejection, rounding,
  pending charges, immutable records, cancellation races, RLS, custom permissions
  and mandatory-audit rollback.
- 40 architecture/access/navigation checks passed; application build passed.
- Hosted workflow: `tests/staging-orders/receivables.spec.ts`, restricted to
  allowlisted staging QA tenants. Hosted verification is pending deployment.

Do not apply this migration or merge this increment to main until separately
authorized for production.
