# R10: Inventory office stock (phase 2D6B2, local)

## Current boundary

Product identity, MRP, categories, taxes and supplier mappings remain shared
within the tenant. Operational quantities, cost and reorder settings live in
`InventoryOfficeStock`, with one versioned balance per office/product. The old
four global stock columns have been removed; there is no dual write, runtime
compatibility flag or tenant-specific override.

Product lists, details and sorting/paging resolve an accessible explicit office,
or the user's persisted workspace office. A missing balance in that permitted
office is a genuine zero/version 0. Missing or denied context returns an error;
it never becomes a fabricated zero or an all-office aggregate. Closed offices
remain readable. Office choices use Inventory's own Read permission, without
delegating Appointments or directory administration.

The stock dashboard names and uses the permitted persisted office only and is unavailable
when that context is missing. Shared catalogue choices for bookings/coupons carry
identity, MRP and tax references, without office costs, counts or reorder data.

## Mutations and financial sources

Every Inventory mutation retains the phase 2D6A transaction boundary: current
account, profile actions, Read bounds and activation are refreshed after the
shared tenant operation lock. Product relationships and mandatory catalogue or
purchase audits commit with the source. Product catalogue audits no longer carry
private office stock values; stock commands write separate complete office audits.

New product and purchase forms capture office/preference version when opened.
The form displays that destination, and a changed workspace preference rejects
creation with a conflict. Stock edits send the saved office and stock version;
a receipt or another correction makes a stale count fail without changing either
stock or shared catalogue metadata. Browsing another office does not change the
creation workspace. Closed-office forms suppress stock mutations.

Purchases have immutable native offices and frozen financial inputs. Their
children, receipts and audits inherit the source office. Receiving uses a private
posted allocation and the saved office, even after a workspace change. Reopening
or replaying Received does not add quantities again. Product count/cost changes,
movements, received quantities, allocations and strict stock audits all roll back
if any required write fails. Runtime callers cannot forge balances or movements
with independent ordinary table writes.

Booking sales/restores similarly derive canonical quantities from the saved
booking and private allocation. A caller's delta map can identify a no-op but
cannot determine the amount or destination. Deferred constraints reject source
changes that omit stock posting. Concurrent operations cannot consume stock from
another office or oversell after reading the same preflight quantity.

Saved purchase labels and booking financial product lines use minimal protected
source projections. Purchase-only users retain saved line labels without gaining
catalogue/stock Read. Invoices retain their saved product lines and prices when
Inventory is disabled. No current stock or catalogue price is exposed by those
financial projections. Two existing child tenant policies now check canonical
tenant/source ancestry; optional catalogue Read no longer decides financial visibility.
Office/source policies and native write guards remain mandatory.

Protected boolean reference checks and purchase-number allocation include hidden
sources without returning their identifiers or counts. Office stock configuration
is an association even at zero count: referenced products become inactive rather
than erasing balances, costs or reorder settings. Archive-only profiles can perform
that status transition without receiving Edit authority.

Sample inventory/purchase creation uses the same business services and captured
office. Repeating those sample commands preserves existing product quantities and
does not receive the same sample purchase again. Destructive seed maintenance is
still subject to native financial-history deletion guards; no reset bypass is
introduced by this change.

## Migration and preservation

Migration 129, `20261027000100_inventory_office_stock`, promotes the SQL rehearsed
in phase 2D6B1 into the deployable migration sequence with its matching Prisma,
service and UI changes. The pending candidate file has been retired.

Each existing product's authoritative saved stock/cost/reorder values move once
to its initial office, retaining timestamps. Incomplete movement sums never
replace the saved quantity, and stock is not copied into every office. Existing
booking/receipt allocations are initialized from saved source quantities without
moving stock again. Exact known booking notes may acquire validated typed links;
other old notes remain intact and unlinked. No old movement is invented or repriced.

Migration preflight rejects conflicting tenant/source relations, invalid saved
quantities or stock-impacting historical bookings outside the initial office.
Missing tenant identities are inferred only from agreeing canonical relations.
IDs, assignments, access rules, grants, financial/branding snapshots and old audit
contents remain intact. Operational old audits acquire initial-office metadata
so their stock values cannot leak to another office. The two child ancestry
policy changes above are explicit; other prior policies/functions/grants remain
unchanged. Forced late rollback and snapshot reconstruction verify preservation
across all 128 preceding tables before the successful local migration.

This implementation remains local on `staging`. No hosted migration, client data
change, push or deployment has been performed.

## Verification

```powershell
npm.cmd run test:inventory-office-rehearsal
npm.cmd run test:inventory-offices
npm.cmd run test:inventory-transactions
node scripts/test-sales-orders.cjs --availability-boundary
npm.cmd run build
node scripts/test-sales-orders.cjs --inventory --browser-only
```

Tests use disposable local PostgreSQL with a non-owner RLS runtime role. Browser
checks use real synthetic tenant logins against a local production build, never
client accounts. Migration/native checks cover rollback, source preservation,
missing-tenant inference, typed/unlinked history, office privacy, stale counts,
receipt replay, concurrent oversell, source proofs, closed offices, permission
revocation after a lock wait and mandatory audit failure rollback. API checks add
explicit office/version requirements, minimal purchase Read, sample replay and
separate Archive authority. Browser flows exercise saved-office edits/receipts,
office filters, stale creation rejection, signed movements and current grants.

Verified locally on 2026-10-27: 18 migration/native checks, seven multi-office
API checks, 85 Inventory/booking regressions and 176 broader scheduling/workforce
checks passed without skips (the regression suites overlap). Two real-sign-in
Chrome flows passed; stock table/dashboard, saved-source purchase and stale-office form
screenshots were inspected. Production build, TypeScript, changed-file ESLint
and whitespace checks passed.

Broader R10 operational/report/workspace integration and external collaborator
release gates remain pending. Completing this Inventory slice is not approval to
apply the full R10 release to hosted staging or production.
