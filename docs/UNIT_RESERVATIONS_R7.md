# R7.2 - Unique-unit reservations

Scope: staging only. This increment extends Sales Catalog and Sales Orders; it
does not add property fields to the shared order or require Real Estate.

## Workflow

- An administrator or manager can reserve an accessible unique catalog unit
  referenced in the order's saved quotation. Repeatable products, quantities and
  manual quotation lines are outside this workflow.
- Choose a future expiry within 30 days. One active hold/allocation per unit is
  enforced by a database unique index and item/order locks. Repeated creation for
  the same order reuses its active reservation without extending its expiry.
- A hold immediately stops blocking availability at its expiry. Reads display
  Expired without writing. The next reservation of that unit, or cancellation of
  its order, materializes the expiry event and mandatory audit. No cron job or
  request to the original order is needed to free the unit.
- Allocation is explicit and requires a confirmed order and an unexpired hold.
  Allocated units have no effective expiry. Allocation is an operational claim,
  not a payment, stock movement, invoice, legal transfer or accounting entry.
- Release requires a reason and makes the unit available again. To extend a hold,
  release and reserve again; the history remains visible. Released/expired records
  cannot be reopened. A replacement is a new reservation.
- Cancelling an order releases all its holds and allocations, including when
  Catalog is disabled or property access has changed. Order-cancellation permission
  authorizes this necessary cleanup. Both changes and all audits commit together.

## Access and presentation

Sales Catalog and Sales Orders (including Sales Documents/CRM dependencies) must
be active for reservation endpoints. Separate `unitReservations.read/create/confirm/
cancel` permissions govern reading, holding, allocation and release. Mutations
remain restricted to administrators/managers, even if a staff role has permissions.
Reading also requires `catalogItems.read` and `salesOrders.read`. Current opportunity
scope and catalog extension/project access apply; neither tenant nor ordinary team
membership expands visibility. Existing custom roles gain no new permissions.

The order detail displays a Unit reservations section only with module/read access.
Reservations and their immutable actor/time/reason history are paged. Catalog
lists/details show Reserved or Allocated, and Available searches/quotation pickers
exclude active reservations. No competing order or customer identity is exposed
through catalog availability. Reserved/allocated catalog items cannot be edited or
archived until released. Original manual availability is retained and never
overwritten by reservation transitions.

Disabling a module hides its workflow but does not free committed allocations or
unexpired holds. Re-enable the required modules to manage them, or cancel the order.
Global reservation audit rows remain administrator-only with the relevant modules
and read permissions; scoped history is available on the order.

## Storage and verification

Migration `20261023000100_unit_reservations` adds UnitReservation and
UnitReservationEvent with forced RLS, composite tenant foreign keys, immutable
snapshots/history, valid-transition guards and active-unit uniqueness. Guards also
prevent catalog edits and direct order cancellation from bypassing reservations.
Existing records, module flags and saved role assignments are unchanged.

`npm.cmd run test:sales-orders` replays all 104 migrations in a disposable local
database and runs reservation, order, catalog and quotation integration checks.
The current checkpoint passed 40 checks, plus 40 module/access/architecture/
terminology checks. TypeScript, targeted lint and the production build passed.
The production build is a local check, not a production deployment.

Hosted writes use only existing QA Staging A/B and the verified staging database
`oyhsrcmjhwxhvepdbcdc`. No production release is authorized for this phase.

```powershell
$env:RUN_STAGING_ORDER_WRITES = '1'
node node_modules/@playwright/test/cli.js test --config playwright.staging-orders.config.ts
```

The hosted test creates synthetic equipment units and saved quotations, exercises
hold/allocation/release/cancellation/expiry, checks tenant/staff/origin/module
restrictions and captures desktop/mobile screenshots. It uses application APIs;
no hosted database fixture, reset, seed or client-data write is involved.
Deployment and hosted verification evidence will be recorded after rollout.
