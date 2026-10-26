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

## Phase 2D6B1: native stock migration rehearsal (local candidate)

`prisma/pending/inventory-office-stock.sql` contains the proposed atomic native
cutover. It deliberately lives outside `prisma/migrations`: the active Prisma
schema and Inventory services still use tenant-wide stock. Ordinary migration or
deployment commands cannot apply this candidate. Promote it only with the
matching runtime/schema change and its passing integration/browser checks.
There is no runtime dual-write or compatibility adapter.

The candidate separates shared catalogue identity/MRP from office quantity,
cost and reorder settings in `InventoryOfficeStock`. A monotonically increasing
stock version protects count corrections. Each existing product moves once to
its initial office with its exact saved operational values and timestamps. The
four old product stock columns are removed in the candidate schema. Historical
movement sums never replace the authoritative saved quantity, and opening stock
is not copied into every office or invented as new movement history.

Purchases receive immutable native offices; their children and receipt history
follow the source. Typed booking links are added to movements only when an exact
known note, tenant and product agree. Other old notes remain unchanged and
unlinked. Existing prices, invoice branding, financial snapshots, IDs, timestamps,
assignments, access rules and grants are preserved. Historical product audits
containing operational values keep their full snapshots, with initial-office
metadata protecting those values. Shared catalogue audits after cutover must
exclude office stock data.

Private booking/receipt allocation rows record quantities already posted. They
are initialized from saved sources without moving stock again. Public native
commands derive their amounts from canonical saved sources, under the shared
operation lock; no caller-supplied delta map is authoritative. Booking edits and
cancellations debit/restore the saved office even after a workspace change.
Receipts use the protected posted quantity, reject tampered received quantities,
and cannot be replayed to add stock twice. Deferred constraints reject business
source changes that omit the matching stock posting. Saved purchase inputs and
office identities are immutable.

Office balances, private allocations and movement history cannot be written
directly by the ordinary runtime role. Native commands recheck current account,
profile action, Read limit, activation and office access after taking the lock.
Stock changes and mandatory complete stock audits commit or roll back together.
Closed offices retain authorized history but reject writes. Read helpers require
an accessible explicit/persisted office; missing context is not a zero balance.
Protected reference and number projections prevent hidden office rows from
being mistaken for unused products or unused purchase numbers.

Preflight rejects conflicting tenant/source relations, invalid quantities and
stock-impacting historical bookings outside the initial office. Those balances
need explicit reconciliation rather than guessed distribution. Missing tenant
identities are inferred only from agreeing canonical relations. A forced late
rollback is rehearsed before the successful local candidate application.

The rehearsal command creates disposable local PostgreSQL, applies/verifies all
128 prior migrations, then exercises the pending SQL with a non-owner runtime
role. It changes neither the actual migration ledger nor hosted environments:

```powershell
npm.cmd run test:inventory-office-rehearsal
```

Verified locally on 2026-10-27: all 18 candidate migration/native checks passed,
including exact preservation across the 128 prior tables, forced rollback,
missing-tenant inference, typed/unlinked history, office privacy, receipt replay,
concurrent oversell, saved-office restores, deferred source proofs, closed offices,
creation versions, current access revocation after a lock wait, and complete audit
failure rollback. The unchanged active Inventory/booking suite also passed all
85 tests without skips. TypeScript, changed-file ESLint and whitespace checks
passed. The candidate has no application/UI deployment to browser-test yet.

### Next: phase 2D6B2 runtime cutover

The candidate is not completed Inventory office isolation in the application.
The next atomic implementation must:

- Update Prisma models and replace all global product stock reads/writes with
  office balances and native posting, including booking adapters, receipts,
  product DTOs, list sorting/paging, dashboard data and authorized seed tools.
- Require explicit saved `officeId`/`stockVersion` for corrections; capture office
  and preference version for product/purchase creation. Edits use source offices.
- Add office browsing/labels, creation headers and source-aware product choices
  to forms; closed offices must not advertise mutations. Do not reuse appointment
  permissions as an Inventory office picker permission.
- Partition purchase audits by source office, use protected integrity checks for
  product/supplier archives, and map native errors into clear 400/403/409 results.
- Add API and real-sign-in browser tests across offices, update old fixtures
  explicitly, and verify reports/history/exports. Promote this SQL to the next
  numbered migration only with that complete service/schema switch.

## Phase 2D6B: release prerequisites

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
