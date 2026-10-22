# R7.1 - Shared Sales Orders: implementation scope

Status: R7.1 deployed and verified on hosted staging (2026-10-23, Asia/Kolkata).
R6 production branding/PDF release is complete.
The R6 recovery companion is implemented locally; see STORAGE_RECOVERY.md.

## First increment

Create a draft sales order from an accessible saved quotation revision. Preserve
the selected customer identity, agreed lines, calculation, currency and source
revision in a server-created snapshot. A separate explicit action confirms the
order; an authorized cancellation records its reason and actor. Saving, previewing
or issuing a quotation does not create or confirm an order.

Keep this increment industry-neutral. Use a new owning `modules/sales-orders/`
module and application composition for the Sales Documents source adapter. Do not
reuse AppointmentOrder or add property fields to the shared order model. A future
Real Estate reservation extension can associate a property unit with the order.
Tenant terminology may display Sales Order as Booking without changing its rules.

## Implemented rules

- Separate optional `salesOrders` activation, dependent on Sales Documents and its
  existing CRM dependency. Platform allowance and tenant enablement both apply;
  migration must not automatically activate existing tenants.
- Explicit read, create, confirm and cancel permissions. Apply current tenant and
  opportunity record scope on every request, forced RLS and composite tenant FKs.
  Deactivating a dependency must follow the existing dependent-module rules.
- States: Draft, Confirmed, Cancelled. Confirmation is explicit. Cancelled is
  terminal; retain records and history rather than deleting or reopening them.
- Server copies a selected saved revision. No caller-supplied customer/price/total
  snapshot. New quotation revisions never change existing orders. In this first
  increment, changing agreed commercial terms requires cancelling the draft and
  creating one from the corrected quotation revision.
- One non-cancelled order per quotation, enforced in the database. Repeated or
  concurrent creation requests return the same order for the same source revision;
  a conflicting revision returns a conflict. Cancellation permits a replacement.
- Version checks and row locks protect confirmation/cancellation. Transitions and
  audit events commit atomically. Show the source revision, state, actor and time.
- Quotation issuance and order confirmation are distinct actions. Do not require
  PDF storage to create a draft or silently interpret PDF issuance as acceptance.
- Confirmation in R7.1 records the commercial agreement only: it does not reserve
  property, decrement stock, create appointments, record money received or close
  the opportunity automatically. Explain that boundary where users confirm.
- Reuse existing decimal calculation and currency rules; never convert agreed
  values to JavaScript floating-point calculations or reuse appointment cents as
  a general financial model.

## Delivery sequence and verification

1. Additive schema/migration, module and permission registration; tests for existing
   data preservation, no automatic activation, RLS and tenant foreign keys.
2. Source adapter and create/read/list/confirm/cancel service with transactional
   auditing, pagination, current permissions and record scopes.
3. Shared list/detail UI, quotation Create Sales Order entry point, confirmation
   dialogs, cancellation reason and order history. Use existing access-aware page
   components and terminology; check desktop/mobile layouts.
4. Isolated integration/concurrency tests and synthetic staging workflows. Record
   hosted evidence separately. No production migration or deployment as part of
   local implementation; review and release after staging verification.

Reservations/expiry/unique-unit allocation belong to R7.2. Receivables, payment
allocations, reversals, accounting and payment gateways belong to later work.
Do not silently extend this first increment into fulfilment or accounting.

## Access and operational decisions

- Tenant administrators and managers with `salesOrders.confirm` / `salesOrders.cancel`
  can perform those transitions. Staff can read/create assigned orders but cannot
  confirm/cancel, even if a custom role includes those permissions. The Salesperson
  template includes order read/create; existing saved roles are not expanded.
- Create also requires `quotations.read`. Order reads and transitions require their
  own permissions and the current source opportunity record scope. Manager scope
  can be own records, managed teams or all tenant records; ordinary team membership
  does not expand staff access. Reassignment affects visibility, not saved terms.
- Customer name/email/phone are preserved from the selected revision. There is no
  inferred customer foreign key: historical quotation snapshots did not freeze a
  contact ID, and the current opportunity contact may have changed.
- History is visible on each authorized order. Global audit reports retain the
  existing admin-only policy for these events and hide them while the module is
  unavailable. Order changes fail atomically if the mandatory audit cannot save.
- Saved terms, histories and cancelled orders cannot be updated/deleted directly.
  A partial unique index allows one active order per quotation across revisions;
  this SQL index is intentional and is not represented as a Prisma unique field.
- No order PDF or new Storage objects are created. The source quotation link opens
  the exact saved revision. Source quotations remain governed by their existing
  preview/issuance workflow.

## Local verification and rollout

The additive migration `20261022000100_sales_orders` creates two tables, forced
RLS, composite tenant foreign keys, immutable-record triggers and the active-order
index. It does not update client records or activate existing tenants. The isolated
runner replays all 103 migrations and compares existing quotations, revisions,
contacts, opportunities and module flags before/after the final migration.

Commands:

```powershell
npm.cmd run test:sales-orders
npm.cmd run build
npm.cmd run test:sales-orders -- --browser-only
node --require ./tests/register.cjs --test tests/module-navigation.test.cjs tests/access-policy.test.cjs tests/terminology.test.cjs
```

The runner uses a disposable loopback-only Postgres container, a restricted RLS
runtime role, and synthetic tenants. It never loads hosted environment files.
Browser checks cover the saved-quotation action, draft/confirmed/cancelled history,
required cancellation reason, cross-origin write denial, staff restrictions,
disabled-module UI/API access and desktop/mobile layouts. Screenshots are under
`test-results/local-access/sales-orders-generic-order-bdc53-trols-on-desktop-and-mobile/`.

Before staging rollout, apply this migration to the verified staging database and
check that the actual application runtime role has SELECT/INSERT/UPDATE on
`SalesOrder` and SELECT/INSERT on `SalesOrderEvent` (no grants to PUBLIC). The
isolated test helper explicitly grants its disposable runtime role table access.
Deploy matching code and enable Sales Orders only for synthetic staging tenants.
Repeat the workflow against the hosted deployment before any production release.
Production migration, backup, deployment and client activation remain separate.

Verified locally on 2026-10-22: 25 integration checks (orders plus quotation
regression), 15 module/access/terminology checks, one end-to-end browser workflow,
TypeScript production build and targeted ESLint passed. Desktop/detail and mobile
list/cancellation screenshots were inspected. The successful integration receipt is
`tmp/industry-release/ls-erp-sales-orders-b397eea56e85.log`; the matching-build
browser receipt is `tmp/industry-release/ls-erp-sales-orders-8ce955a5d570.log`. At that local checkpoint, no hosted schema change, Git push or deployment had been performed.


## Hosted staging verification - 2026-10-23

Application commit `6a8424e75f8eb4e58143ee7b927c7379107addfc` is READY on
`leiwissen/ls-erp-staging`, deployment `dpl_7VvPTc4K4q9cvwtqSqR8dyUQvgX7`.
The main staging URL and both existing synthetic QA tenant aliases point to this
same deployment. The staging Supabase project is `oyhsrcmjhwxhvepdbcdc`.

Migration 103 applied with all historical migration checksums verified. Aggregate
fingerprints matched for 11 existing data/configuration tables. Runtime role
`prisma_app` remains NOSUPERUSER/NOBYPASSRLS; explicit grants cover the two new
tables. After creating synthetic orders, direct runtime reads proved that missing
and foreign tenant contexts see neither their order nor history; the owning
context sees the expected record. All three lifecycle events have mandatory audit
entries matching the order history.

The hosted Playwright workflow passed against QA Staging A/B:

- Platform allowance and tenant enablement; dependency-protected disablement.
- UI draft creation, confirmation and required cancellation reason/history.
- Exact saved quotation identity/terms; later revision changes preserve the order.
- Concurrent duplicate requests reuse one order; conflicting revisions are denied;
  cancellation permits a replacement from revision 2.
- Cross-tenant read/list/create denial, staff confirmation denial, cross-origin
  write denial, stale version rejection and terminal cancelled state.
- Fresh custom-manager permissions independently gate create, confirm and cancel.
- Disabled module blocks API/UI and hides the quotation action; re-enable restores
  access. Desktop and 390px mobile screenshots were inspected; no browser errors.

Only synthetic QA records/users/roles were created. Sales Orders remains enabled
on those two QA tenants for review. No local seed/reset helper ran against hosted
storage or the database. Production alias `erp.ewissen.in` still points to
`dpl_BVmvJ2iay6VneUXS1vjYerXuA3RC`, and GitHub main remains `c0905b4`.

Repeatable opt-in command (requires existing private QA state and staging env file):

```powershell
$env:RUN_STAGING_ORDER_WRITES = '1'
node node_modules/@playwright/test/cli.js test --config playwright.staging-orders.config.ts
```

The hosted suite accepts only the three fixed staging origins and checks tenant
identities after login. Authentication is ephemeral, traces are off, and secrets
remain in ignored local files. Screenshots: `test-results/staging-orders/`.
Private aggregate receipts: `tmp/staging-setup/r7-migration-receipt.json`,
`r7-deployment-receipt.json`, `r7-hosted-verification.json`, `r7-final-receipt.json`.
Production rollout remains a separate release.
