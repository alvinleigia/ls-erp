# http://platform.localhost:3000/ - Email: alvinaraujo@gmail.com Password: password123
# http://storefront1.localhost:3000/ - Email: storefront1.admin@ls-salon.test Password: password123
# Base Conventions

This is the baseline for new modules (API + UI) in this codebase.

## List API contract
- Params: `page` (1-based), `pageSize`, `sort`, `order`, `q`
- Response: `{ items, page, pageSize, total, totalPages }`
- Shared type: `types/api.ts` -> `ListResponse<T>`
- Notes:
  - Use `q` for simple text search.
  - `sort` matches a known column key; `order` is `asc` or `desc`.
  - Keep server-side pagination (do not load all rows).
  - List endpoints may optionally accept `status` filters when applicable.

## Permissions
- Use helpers from `lib/permissions.ts` in both server and client.
- Server always checks `auth()` + helper.
- UI should only hide/disable; server is source of truth.
- Tenant provisioning/lifecycle actions must use `canManageTenants` and remain restricted to platform admin users.

## Multi-tenant SaaS
- Tenant context is derived from host/subdomain (`lib/tenancy.ts`); API routes should use `requireTenantSession` (`lib/tenant-auth.ts`) for tenant-safe authorization.
- All tenant-domain reads/writes must filter by `tenantId`; avoid cross-tenant lookups even for internal helper queries.
- Database isolation is also enforced with Postgres row-level security (RLS) for tenant-owned tables.
- Tenant-scoped API/auth entrypoints must establish DB context through `lib/prisma.ts` helpers (`requireTenantSession`, `enterTenantDbContext`, `enterRlsBypassDbContext`) before issuing Prisma queries.
- Use RLS bypass context only for narrowly scoped platform/provisioning flows that intentionally cross tenant boundaries.
- All Prisma clients share one process-wide pool. The tenant adapter sets both RLS values transaction-locally, including for standalone queries; never introduce persistent session `SET` or a separate tenant pool. Supabase runtime uses transaction pooling; migrations retain their direct/session connection.
- After awaiting authorization, explicitly wrap database work in `runWithTenantDbContext` or (for authorized platform operations) `runWithRlsBypassDbContext`. An async helper's `enterWith` context does not propagate back to the awaiting caller; do not rely on it for subsequent route queries.
- Keep one shared database with strict tenant scoping in Prisma queries and model uniqueness constraints (`@@unique([tenantId, ...])` where applicable).
- Platform operations (tenant provisioning, status lifecycle, admin reset) are centralized under `/api/tenants*` and must validate platform-tenant scope (`PLATFORM_ADMIN_TENANT_SLUG`).
- Tenant management UI lives under `/settings/tenants` and is only visible/accessible for platform admin users.
- `/api/tenants` storefront listing excludes the `platform` control-plane tenant. Business tenants are provisioned explicitly and have no special default/fallback tenant.
- Use a dedicated platform tenant slug (recommended: `platform`). The obsolete `tenant_default` bootstrap record is removed by the retirement migration; do not recreate it in seeds or runtime code.
- Tenant admin profile management (name/email/phone/status/password) is handled via `/api/tenants/[id]/admin` and exposed from `/settings/tenants` row actions.
- Platform danger reset is handled via `/api/tenants/reset-all` (confirmation token required); preserve the configured platform-admin login tenant and allow optional platform-tenant preservation.
- Platform super-admin scope is provisioning-only:
  - allowed UI surface: `/settings/tenants`.
  - allowed API surface: `/api/tenants*` (plus auth/session endpoints).
  - block platform super-admin from domain modules/data routes (`/users`, `/services`, `/appointments`, `/inventory`, `/shifts`, `/leaves`, `/reports`, `/settings/*` except tenants).
- Tenant lifecycle transitions are status-based (`ACTIVE`, `SUSPENDED`, `ARCHIVED`); never hard-delete tenants through admin flows.
- Tenant admin credential recovery should use reset-token flow (`PasswordResetToken`) and tenant-aware reset URLs (subdomain/root-domain aware).
- Platform tenant records (slug matching `PLATFORM_ADMIN_TENANT_SLUG`) must be protected from accidental lifecycle mutations.
- URL generation/redirects in multi-tenant flows must be host-aware:
  - client-side links: use `window.location.origin`.
  - API-generated links: derive from `request.url` / request headers.
  - avoid fixed-origin env vars (for example `APP_URL`, `NEXT_PUBLIC_APP_URL`) for tenant-domain links.

## Audit logging
- Domain-changing APIs should write audit rows via `recordDomainAuditEventSafe` (`lib/domain-audit.ts`).
- Include `tenantId`, `event`, `entityType`, `entityId`, `actorUserId`, `actorRole`, and `requestId` whenever available.
- Include `before`/`after` snapshots for status transitions and key mutable fields.
- Required tenant-admin audit events:
  - `tenant.created`
  - `tenant.status.updated`
  - `tenant.admin.reset_sent`
  - `tenant.admin.updated`
  - `tenant.reset_all`

## Delete policy (global)
- Default: **restrict delete** if the record is referenced by other records.
- When allowed, perform **soft delete** by setting status to INACTIVE/ARCHIVED.
- Use 409 responses with a clear message when deletion is blocked.
- If there are no associations, hard delete is allowed; otherwise soft delete.
- Use confirmation dialogs for destructive actions (no toast confirms or `window.confirm`).

## Validation + types
- Define Zod schemas in `lib/validation.ts`.
- Export inferred types from the same file (no separate DTOs unless needed).
- Put reusable domain/UI types in `types/<domain>.ts` (example: `types/scheduling.ts`, `types/shifts.ts`) and import them instead of redefining per page.
- API: `schema.safeParse(body)` and return `{ error, details }` with `flatten()` on failure.

## Forms
- Use `FormField` from `components/form-field.tsx` for label/input/error.
- Use `useFormErrors` from `hooks/use-form-errors.ts` to map Zod field errors.
- For async form submits, use `Button` loading state (`loading` + `loadingText`) instead of text-only toggles; this shows a spinner and disables the action consistently.
- For large/dynamic master-data selectors (staff, services, products, suppliers, categories, templates), use shadcn searchable combobox (`components/searchable-select.tsx`) instead of plain `<select>`.
- Use the standard edit flow (list/detail pattern) used in Users: list view + dedicated edit page.
- Avoid bespoke split-edit panels for core admin flows unless explicitly required.
- Keep actions consistent with Users: primary save in page header; destructive actions require confirmation.

## Tables
- Use `components/data-table.tsx` with server-side pagination.
- Pass `totalRows` to `DataTablePagination`.
- Use `columnDef.meta.label` for column labels.
- Memoize column action handlers with `useCallback` and include them in `useMemo` deps.
- Suppress `react-hooks/incompatible-library` on `useReactTable` (TanStack) with an inline eslint disable.
- Prefer the standard DataTable + DataTableToolbar + DataTablePagination pattern for admin lists.

## CRM interface
- Keep CRM page layouts within `crmPageClass`, with `CrmPageHeader` for the title, back link and actions. Use `CrmSection` for named sections and `CrmSurface` for list/filter panels. Embedded lists have section headings, not additional page headings.
- Place the primary save and navigation Cancel together in the page header with `CrmFormActions`. Associate the save button with its form ID. Keep independent actions (completion, notes and scheduling a reviewed plan) in that section's right-aligned `CrmActionBar`. Preserve confirmation dialogs for destructive actions.
- Use `CrmSelect` for fixed choices, `RecordSelect` for searchable server-backed records, and shared `Input`, `CrmTextarea` and `CrmCheckbox` controls. Retain labels, disabled permissions and required-field validation. Do not add visible native select controls in CRM.
- Keep search and the main status filter visible. Group additional filters in `CrmFilters` with reset controls and an active-filter count.
- Use `CrmTablePagination` with DataTable, or `CrmPagination` for reports, board columns and timelines. Show the record range on the left, centered Previous / Page / Next controls, and page size on the right. Narrow sections move centered page controls to a second row. Keep server-side paging and reset to page one when filters or page size change.
- Render customer interactions and record history through `CrmTimeline`, with actor, event, timestamp and message. Keep internal-note forms within the history section.
- These wrappers are CRM-specific; other modules retain their existing layout and pagination.
- Keep inline-size containment on the CRM layout boundary. The surrounding app shell is a flex item; wide tables and board columns must scroll inside CRM instead of expanding the document on mobile. Verify layouts within that shell as well as isolated previews.

## Record detail views
- Projects/subprojects use the shared `CrmRecordTabs`, `CrmReadOnlyFields`, `CrmRecordMenu` and `CrmEditPanel` from `modules/crm/components/crm-record-detail.tsx`. Reuse these when adopting the pattern in other CRM records; do not copy panel/tab markup.
- Saved records open read-only. Focused edits use the panel's fixed Cancel/Save footer and discard confirmation. Creation retains the standard page-header form actions.
- Mount related lists only in the active tab. Keep server paging and permissions. Empty lists omit pagination but retain filters needed to recover archived or filtered-out records.

## Email templates
- Put templates in `lib/emails/*`.
- API routes import templates and pass `subject/text/html` into `mailer.sendMail`.

## Settings
- Global settings live under `/settings` (admin/manager).
- Start with locale, currency, time zone, date format, time format, first day of week, currency symbol placement, and number format.
- Store working hours in settings with day-based periods (WORK/BREAK) and allow multiple breaks.
- Support special date overrides in settings (date-specific periods override weekly hours).
- Validate working hours/overrides: start < end and no overlapping periods.
- **Date storage:** persist date-only values as Postgres `DATE` (Prisma `DateTime @db.Date`) and use ISO `YYYY-MM-DD` in APIs.
- **Date display:** format dates for UI using `settings.dateFormat` (use `lib/date.ts` helpers).
- Use settings for formatting (no hard-coded currency/locale).
- Settings selectors for locale/currency/time zone should use shared constants from `lib/constants/localization.ts` (with custom-value fallback when existing data is outside curated options).
- Settings API is dynamic (no caching).
- Taxes are managed in `/settings/taxes`; appointment orders can apply multiple selected taxes and pricing must be server-authoritative.
- When formatting values (currency/locale), ensure memoized columns include formatter dependencies.
- Large dialogs should have `max-h-[80vh] overflow-y-auto`.
- For long forms, keep the footer outside the scroll area (scroll only the form body).
- Apply the fixed-footer dialog pattern across all form dialogs.
- Package item pickers should include a local search input.
- Shift templates are managed outside Settings (see Shifts module).
- Seeds admin tools live under `/settings/seeds` with admin/manager access.

## Seeding + reset conventions
- Seed/clear operations are API-driven via `/api/seeds` and must remain role-gated (`canManageUsers`).
- Seed/clear operations must be tenant-scoped to the current tenant context (host/session tenant); never run cross-tenant deletes from this API.
- Seeds must not create/update/delete admin users; admin records are preserve-only.
- Seeds must not modify global settings (`AppSetting` + working hours/overrides).
- Seed groups should be dependency-aware (auto-run prerequisites), and response should include executed groups.
- Seed users should include 5 customers, 5 staff, and 2 managers (non-admin only).
- Seed services should include at least 10 services and include `ServiceType.PACKAGE` examples with `ServicePackageItem` composition.
- Seed tax defaults:
  - services use GST (`GST 18%`).
  - inventory products use VAT (`VAT 5%`).
- Seeding services must also seed staff eligibility (`StaffServiceEligibility`) for seeded staff/users.
- Seeding appointments must snapshot taxes correctly on order lines and order tax summaries (do not hardcode zero tax).
- Full clear action preserves only admins + global settings and returns deleted counts.
- Module clear actions must support:
  - preview (`previewModulesClear`) with delete counts + expanded modules.
  - execution (`clearModules`) with dependency-aware expansion and safe delete ordering.
  - modes: `strict` (error on missing dependencies) and `include_dependents` (auto-expand).
- Module clear ordering should delete leaves first to satisfy FK constraints:
  - `appointments -> coupons -> purchases -> inventory -> shifts -> services -> taxes -> users`.

## Module checklist
- Prisma model + migration (if new data).
- Zod schema + inferred type in `lib/validation.ts`.
- API routes under `app/api/<module>`.
- UI page under `app/(protected)/<module>` with DataTable + dialogs.
- Permissions enforced in API + layout guards.
- Update navigation in `components/app-sidebar.tsx` (use submenus for grouped routes like Users + Invitees).
- Keep Users page actions minimal (no Invitees button inside the Users view).
- Add icons to main nav items (lucide) for quick scan.
- Sidebar sub-menu buttons should be full width for consistent hover styling.
- Sidebar sub-menu container uses left padding only (no right padding).
- Use extra vertical spacing between menu items for breathing room.
- Menu buttons use extra horizontal/vertical padding for touch targets.
- Invitees list supports status filter (pending/accepted/expired) via `status` query param, defaulting to pending.
- Service categories module lives under `/services/categories` with admin/manager access.
- Services module lives under `/services` with admin/manager access and uses standard list params/response.
- Services can define default taxes (from `/settings/taxes`); booking forms should preselect these taxes and still allow manual overrides.
- Services must define a default tax mode (`EXCLUSIVE` or `INCLUSIVE`) with their default taxes; booking line items snapshot both values at the time of booking.
- Appointment order tax calculation is line-based (per service line tax mode + tax ids) and order-level tax rows are aggregated summaries.
- Packages are services with `type=PACKAGE` and must include package items (services).
- Staff eligibility: default allow all services; if any eligible services are stored, treat as an allow-list.
- Manage staff eligibility in the staff profile page (not in the general user create/edit form).
- Staff profile includes documents list (type/number/link/validity), and certifications list (with issue + expiry dates).
- Staff scheduling uses shift schedules (start date + shift blocks) and staff schedule assignments with date ranges.
- Staff profiles support scheduling modes:
  - `STANDARD`: schedule/assignment driven (default).
  - `FLEXIBLE`: supports two layers:
    - recurring base pattern (`cycleLengthWeeks`, `validFrom`, optional `validTo`) via `/api/shifts/flexible-patterns`.
    - week-specific override plan (`week -> days -> slots -> breaks`) via `/api/shifts/flexible-week-plans`.
    - availability should resolve as: weekly override -> recurring pattern -> legacy date slots (backward compatibility only).
- Shift schedules use week off day 1 and optional week off day 2 with week-of-month selection.
- Do not allow schedules or assignments to start in the past.
- Repeat day counts skip week off dates; shift blocks loop in order indefinitely, and assignments control when a schedule applies.
- A single global default shift schedule can be marked and applies to staff without explicit schedules.
- Roster displays only shift schedules; if no staff schedule and no default schedule, show empty.
- Roster should merge sources in precedence order: leave -> override -> flexible weekly override -> flexible recurring pattern -> assigned/default schedule.
- Roster overrides apply shift templates or mark a date range unavailable for a staff member (skip holidays/week off optional).
- Shift overrides must not conflict with booked appointments. Require a resolution action (cancel, reassign, or reschedule) before applying changes.
- Leave definition day-length policy should use only:
  - `minDaysPerRequest`
  - `maxDaysPerRequest`
  - treat `maxConsecutiveDays` as deprecated in API/UI and keep it internally mirrored to `maxDaysPerRequest` only for DB backward compatibility.
- Appointment domain contracts live in `types/appointments.ts` (status/action/request/response and row/form shapes).
- Appointment conflict resolution payloads must use `appointmentResolveSchema` in `lib/validation.ts` for API validation.
- Appointment booking uses one shared form component/model, opened from both calendar cell click and "New appointment" action.
- Billing-oriented appointment creation/editing should use dedicated full pages (`/appointments/new`, `/appointments/[id]/edit`) rather than modal-only flows.
- Appointment order APIs live under `/api/appointments/orders` and persist invoice-style bookings (lines + coupons + totals).
- Appointment order lines store `startAt/endAt` and link to `Appointment` via `Appointment.orderLineId` when booking is confirmed.
- Appointment orders support two line types:
  - service lines (`AppointmentOrderLine`) for schedulable services/staff/time windows.
  - product lines (`AppointmentOrderProductLine`) for inventory sale items (non-schedulable).
- Product lines must not create/update `Appointment` schedule rows; only service lines participate in slot scheduling.
- Order pricing totals (subtotal, discounts, coupons, taxes, grand total) must aggregate across both service and product lines, with server-authoritative calculations.
- Coupons support multiple codes; keep phase-1 rules simple and deterministic (server-authoritative pricing).
- Coupon definitions are managed in `/appointments/coupons` via `/api/appointments/coupons` (CRUD).
- Coupon reporting endpoints should live under `/api/reports/*` with list pagination shape (`items`, `page`, `pageSize`, `total`, `totalPages`) and role-gated access.
- Coupon definitions support scope metadata for enforcement:
  - `appliesTo`: `ORDER`, `SERVICE_LINES`, or `PRODUCT_LINES`.
  - allow-lists: `allowedServiceIds`, `allowedCategoryIds`, `allowedProductIds`.
  - thresholds/rules: `minSubtotalCents`, `stackingMode` (`STACKABLE` or `EXCLUSIVE`).
  - usage caps: `maxUses` (global), `maxUsesPerCustomer` (per-customer limit).
- Coupon scope fields should be backward compatible: default to order-wide + stackable + no allow-list restrictions.
- Appointment order pricing enforces coupon scope server-side:
  - eligibility is line-based (service/product/category allow-lists + `appliesTo`),
  - `minSubtotalCents` is evaluated against the coupon's eligible line subtotal at apply time,
  - `EXCLUSIVE` coupons do not stack with other coupons,
  - `maxUsesPerCustomer` blocks coupon application once the customer reaches the configured limit.
- Appointment create/update APIs must enforce staff availability against schedules + overrides + week-off/break windows (not only overlap checks).
- Appointment UI should call `/api/appointments/availability` as a pre-check and show inline slot status before submit.
- Appointment flows should expose explicit actions for Edit, Reschedule, and Cancel (with confirmation for cancel).
- Appointment list edit/reschedule should be order-based only:
  - if `appointment.orderLine.order.id` exists, route to `/appointments/[orderId]/edit`.
  - legacy/non-order appointments should not fallback to modal edit.
- Shifts module lives under `/shifts` with admin/manager access and uses standard list params/response.
- Shift schedules live under `/shifts/schedules` with admin/manager access.
- Shift templates store a single shift start/end with optional breaks and are reusable across schedules/overrides.
- Shift template deletion is blocked when assigned to staff (409 response).
- Roster UI lives under `/shifts/roster` and uses Syncfusion Scheduler (month view).
- Scheduler hides non-business hours with `showNonBusiness: false` and business hour bounds.
- Inventory module lives under `/inventory` with admin/manager access and uses standard list params/response.
- Inventory module subroutes: `/inventory/categories`, `/inventory/suppliers`, `/inventory/purchases`.
- Inventory products require CP (`costPriceCents`) and MRP (`mrpCents`), support multiple suppliers, and can define default taxes from `/settings/taxes`.
- Supplier tax identity must remain global (not country-specific): use `isTaxRegistered` + `taxRegistrationType` (`VAT`, `GST`, `SALES_TAX_ID`, `EIN`, `OTHER`) + `taxRegistrationNumber` instead of single-region fields like GSTIN-only labels.
- Inventory product units are standardized via shared constants (`lib/constants/inventory.ts` -> `INVENTORY_UNIT_OPTIONS`) and validated in API schemas (no free-text units in create/update flows).
- Country pickers should use shared constants (`lib/constants/countries.ts` -> `COUNTRY_OPTIONS`) instead of free-text country inputs, including supplier/profile/user forms.
- State/province input should be country-aware using shared mapping (`lib/constants/countries.ts` -> `COUNTRY_STATE_OPTIONS`): use dropdown when mapping exists, otherwise keep free-text fallback.
- Product-supplier links store supplier-specific SKU/cost/min-order/lead-time with a single preferred supplier.
- Purchase receipt updates inventory stock by writing stock movement ledger entries (`InventoryStockMovement`) and incrementing on-hand quantity.
- Booking product sales/restores must adjust inventory on-hand and write stock movement ledger entries:
  - `BOOKING_PRODUCT_SALE` for deductions.
  - `BOOKING_PRODUCT_RESTOCK` for restores.
- Stock adjustments for booking product lines are status-transition based:
  - `DRAFT/CANCELED -> CONFIRMED/COMPLETED`: deduct.
  - `CONFIRMED/COMPLETED -> DRAFT/CANCELED`: restore.
  - edits within impactful statuses apply quantity deltas.
- Return 409 for stock conflicts (e.g., insufficient stock) with a clear message.
- Inventory delete policy follows global rules: soft delete via `INACTIVE` when references exist; hard delete only when unreferenced.
- List pageSize max is 100 unless explicitly raised (align UI requests accordingly).
- Seed helpers live in `scripts/` (use `seed-service-categories.js` for defaults).
- Services seed: `scripts/seed-services.js` (requires categories).
- Reuse shared date range picker UI instead of duplicating range popover logic:
  - component: `components/date-range-picker.tsx` (shadcn `Button` + `Popover` + `Calendar`).
  - current consumers: dashboard and appointments pages.
  - appointments table date filtering should send `startDate` and `endDate` to `/api/appointments`.
  - date range picker should support explicit boundary edits (`From`/`To`) and allow restarting range selection cleanly after a completed range exists.

## CRM record detail and editing

Use the shared record view/form boundary for saved CRM records. Keep related
lists in lazy record tabs, show read-only summary sections, and open the shared
edit panel from section actions. Reuse CrmSection for collapsible form sections
and CrmDraftPanel for small configuration editors. See CRM_RECORD_VIEWS.md.
