# R10: Inventory transaction and office-stock work

## Phase 2D6A: transaction and audit foundation (local)

All Inventory category, supplier, product and purchase mutations now refresh
account status, module activation, action profiles and record rules inside their
write transaction, after acquiring the shared operation lock and any source row
lock. Create/edit/archive remain distinct actions. Catalogue status changes and purchase
receipts recheck their secondary Archive/stock Edit requirements against the
current source and current permissions.

Inventory, scheduling, booking stock work and account-security writes coordinate
through the same stable lock. `platform/transactions/tenant-operation.ts` owns
that shared transaction primitive; the scheduling service retains its domain
entry point and the existing native R10 lock identity. Stock work nested in a
booking transaction reuses the same connection and reentrant lock. Independent
stock writers cannot oversell after reading the same preflight quantity.

Mutations commit the source, product relations, purchase items, receipt quantities,
stock movements and mandatory before/after audit together. An audit failure now
rolls back the business change rather than leaving an unaudited success. Product
snapshots include supplier/tax links; purchase snapshots include line items.
Existing event names and actor/request identities are preserved.

New opening quantities and manual stock-count corrections append signed stock
movements in the same transaction. Existing movement rows are not rewritten and
missing historical movements are not invented. Repeated or concurrent receipt
commands retain cumulative received quantities and do not double-count stock.
Purchase-number allocation and duplicate checks run inside the serialized write.

This phase has no schema or data migration. It adds no runtime compatibility
adapter, role fallback or permission override. Existing client records, ownership,
permissions and historical stock quantities are unchanged. Work remains local on
staging; no hosted database, tenant or deployment was modified.

## Phase 2D6B: next atomic stock-ownership change

Stock is still tenant-wide in the current schema. This phase is a prerequisite,
not completed Inventory office isolation. Before an office-stock release:

- Keep shared product definitions, categories and supplier configuration explicit.
  Separate office balances and operational stock/cost/reorder values from shared
  product identity rather than duplicating the product catalogue per office.
- Give purchase roots immutable offices; items, receipts, movements and audit
  history inherit their canonical source. Booking sales/restores use the saved
  booking office, never a changed workspace preference.
- Move authoritative current quantities into the tenant's initial office without
  changing amounts, IDs, assignments or frozen prices. Do not reconstruct balances
  from incomplete historical movements or copy one balance into every office.
- Apply the same native office boundary to stock reads/writes, receipts, selectors,
  dashboards, history and archives. Stock conflicts remain enforceable without
  exposing another office's records.
- Align forms with captured creation context and saved-source edits; distinguish
  unavailable stock context from a genuine zero balance. Rehearse rollback and
  exact preservation before any hosted cutover.

## Local verification

```powershell
npm.cmd run test:inventory-transactions
npm.cmd run test:inventory-transactions:browser
node scripts/test-sales-orders.cjs --availability-boundary
npm.cmd run build
```

Tests run only against disposable local PostgreSQL. They cover every Inventory
mutation's audit rollback, signed stock corrections, movement failure, receipt
idempotency, duplicate numbering, current Archive and action checks after waits,
module/account revocation and forged service identity. The browser uses real
synthetic tenant sign-ins; no client credentials or client records are used.

Verified locally on 2026-10-26: 85 Inventory/booking tests and 176 scheduling/
booking/workforce regressions passed without skips (198 distinct tests across
the overlapping suites). The real-sign-in Chrome flow passed receipt replay,
manager stock correction, signed movements, audit snapshots and current profile
revocation. Its Inventory screenshot was inspected. Production build, TypeScript,
changed-file ESLint (zero warnings) and whitespace checks passed.
