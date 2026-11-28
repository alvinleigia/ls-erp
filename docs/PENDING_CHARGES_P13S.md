# Unpriced extras and collections

An accepted quotation may contain an extra with **Amount to be confirmed**.
It remains distinct from a confirmed zero. Its amount is excluded from the known
total; original instalment percentages continue to use consideration.

## Staff workflow

1. Confirm the sales order normally. In Payments, open receivables for the known
   schedule and review its due dates. Pending extras remain disclosed separately.
2. Collect known instalments normally, using automatic or specific allocations.
3. Once an extra is agreed, use **Confirm amount** beside that saved charge.
   Enter its final amount, optional due date and a customer agreement reference or
   reason. An explicit zero records that no charge is due.
4. A positive confirmation appends one separate schedule line and increases the
   known total/outstanding balance. It can receive payments like any other charge.
   Confirmation is final and retained in history. Changed agreed prices or
   instalments continue to require the ordinary replacement agreement process.

Receivables Create authorizes both opening schedules and confirming saved extras.
Read, current record/action limits, office access, sharing, tenant/module activation
and confirmed-order checks still apply. No profile grants are added.

## Preservation and native integrity

- The application identifies extras by index in the immutable accepted calculation,
  never labels. Duplicate labels remain separate charges.
- `OrderReceivableCharge` is append-only with unique source/request identities,
  currency precision, actor/reason/version and tenant/order foreign keys. Forced
  tenant, office and source-sharing RLS protect the rows.
- Order locks serialize confirmations, payments, issuance and cancellation. Stale
  balances fail; identical retries return the original confirmation. Native guards
  require an accepted unpriced extra and a matching newly appended line. Deferred
  constraints reconcile totals and advance the balance version, including zero.
- Existing agreements, schedule lines, payments, tax acceptances and issued PDF
  archives are not rewritten. Migration 170 adds an empty child table and changes
  only the explicit receivable admission/confirmation guards.
- Receipt preparation uses the current ledger and discloses unpriced extras in its
  required payment notice. Balance changes invalidate prepared receipts; issued
  copies retain their archived bytes. Letters retain accepted commercial facts
  and their existing separately captured financial view.

## Scope

This is commercial collections, not tax assessment or statutory invoicing.
Confirmation assigns no GST rate, changes no tax acceptance and creates no invoice.
Existing invoice checks requiring fully priced accepted terms remain in force.
Confirming an amount is not a substitute for a tax-reviewed agreement.

The change is shared across industries. Quotation source interpretation stays in
application composition; Real Estate adds property context through its existing
document addon. There is no tenant-specific pricing path or production backfill.
