# R6 — Products and Units

## Scope

Sales Catalog is an optional, industry-neutral module for repeatable products and
individually identified units. Real Estate supplies property details; Sales
Documents accepts catalog selections through an application-installed provider.
Existing Inventory remains responsible for stocked goods, quantities and purchases.

- Core item: tenant-unique uppercase code, name, description, product/unit kind,
  price, currency, price unit, availability, archive state and optimistic version.
- Property unit: project or subproject, configured property category, bedrooms,
  area and area unit. A 2BHK/3BHK uses Apartment plus 2/3 bedrooms; Villa remains a
  configured property category. Each apartment/villa has its own code.
- Availability: Available, Unavailable, and Sold (unique units only). These are
  explicit manager updates. Quoting never reserves or sells an item.
- Catalog list/detail and project Units tab reuse common tables, pagination,
  controls, overview sections and edit panels. Creating from a project/subproject
  carries that selection into the new item form. Parent lists include child units.
- Quotation selection fills description, quantity, unit and rate. Negotiated prices
  remain editable. Currency must match; a unique unit appears once with quantity 1.
  New links require an active, available, accessible item at the selected version.
  Templates use manual lines; concrete item selections belong to quotations.

## Activation and permissions

Platform admin allows Sales Catalog on the tenant; tenant admin enables it under
Settings → Business modules. No existing tenant is enabled automatically. Core
catalog works with CRM disabled. Property fields require Real Estate and project
read/edit permissions. Real Estate retains its CRM dependency.

`catalogItems.read/create/edit/archive` use the shared role registry. Only tenant
administrators and managers can write; assigned custom roles restrict those
actions further. Staff can read generic items and property units in accessible
projects. Project membership is inherited by subprojects. Tenant module state,
account status, permissions and project scope are rechecked in each transaction.

Every mutation is audited in the same transaction. Catalog audit reports respect
catalog activation/read access and property activation/project read access.

## Storage and migration

Migration `20261018130000_sales_catalog` adds CatalogItem and RealEstateUnit.
It changes no existing client rows. Composite tenant foreign keys, forced RLS,
case-normalized code uniqueness and checks protect both tables. Tenant/list and
project-unit indexes support bounded paging. Lists exclude descriptions and detail
payloads. Search uses the existing bounded, case-insensitive substring pattern.

Quoted references are server-created metadata within immutable quotation revision
snapshots. Existing manual quotations remain valid. Historical snapshots never
require a live catalog lookup. Editing an existing quotation may retain its prior
references after catalog changes/deactivation; choosing a new reference rechecks
current access and availability. There is no reservation, stock movement or
automatic availability update on quotation save or opportunity close.

The R5 release manifest remains the historical release baseline. Do not replace
its checksums to accommodate R6. Release R6 with its own migration review and
normal verified backup/deployment process. The source is ready for the R6 push;
the production migration and tenant activation are separate release steps.

## Verification

Verified locally on 2026-10-18: production build and targeted ESLint pass; 54 CRM,
navigation and architecture tests, 6 quotation calculation tests, 23 isolated
integration tests and 1 complete local browser workflow pass (84 checks total).
The browser created a unit from a subproject, verified carried-over selections,
edited price without losing property details, checked the parent Units list and
mobile overflow, and saved a quotation with the unit reference. Availability stayed
Available. Desktop and mobile screenshots were inspected. The final isolated run
receipt is `tmp/industry-release/ls-erp-catalog-dff913ac3b44.log` (ignored).

Production migration and activation remain pending. The user authorized pushing
this tested increment. A Git push may trigger the connected Vercel build; it does
not apply this database migration. Keep Sales Catalog disabled until migration
and release checks are complete. R5 is closed; further testing inside the pilot
client account is not a prerequisite for this feature work.

`npm.cmd run test:catalog` replays the 99 R5 migrations with synthetic historical
fixtures and then applies the R6 migration in a fresh disposable Docker database.
It verifies existing project preservation and no automatic activation, followed
by catalog, quotation and module-access integration tests. No `.env` or hosted
credentials are mounted into the containers.

After `npm.cmd run build`, `npm.cmd run test:catalog:browser` runs the same checks,
then a local Chrome walkthrough using ephemeral synthetic users. The test database
is exposed only on a random loopback port and removed afterwards. Screenshots are
under ignored `test-results/local-access`; no live browser login is reused.

Future phases may add reservations and sales-order fulfilment. Custom field and
terminology registration for catalog items, catalog import, stock integration and
bulk availability changes are outside this first increment.
