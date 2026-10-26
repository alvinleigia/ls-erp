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
- Every module uses composable access profiles from the shared access resolver. Active profiles add action permissions; per-user resource/action record limits, module activation and tenant isolation remain mandatory bounds. Staff/Manager labels grant no business permissions. Tenant Admin retains security administration. See `docs/ACCESS_STANDARDIZATION_R9.md` for the current contract and migration.
- Teams are shared business data under `/users/teams`; CRM owns the sales workflow setting. See `docs/ACCESS_MODEL_R9.md` for module record policies and migration rules.
- Register each permission resource in both `platform/access/catalog.ts` and the exhaustive `platform/access/resource-policy.ts`. Offer record scope choices only where every query path can enforce them.
- Use `authorizeBusinessOperation(tx, identity, requirement, modules)` inside business transactions. It refreshes account status, profiles, resource/action rules, activation and team memberships, then binds the operation. A scheduling workflow must refresh after acquiring its shared lock.
- Register rules in `platform/access/rules.ts`. Missing or invalid entries deny access; adding a new permission never expands existing policies. Offer only scopes supported by the resource adapter. Read bounds every other action through `recordLimits`, including related source lookups and exports.
- Apply the same adapter to lists, details, writes, selectors, reports, exports and dashboards. Use `requireScopedWriteFields` for secondary archive/assignment changes; an Edit grant cannot stand in for Assign or Archive. Filters only narrow access.
- Supported records use shared selected-user/team sharing and Restricted visibility. Use `sharedRecordWhere` with the native owner/source adapter, bind database actor identity, and retain restrictive RLS for linked records and history. Sharing cannot grant a missing profile action or bypass None, activation, tenant or source privacy. See `docs/RECORD_SHARING_R9.md` for the support matrix and migration 111. Scheduling/conflict resources need a privacy-safe availability adapter before offering record sharing.
- Use `recordActionAccess(actor, resource, id, tx, probe)` after a scoped detail lookup. Pass its metadata to the shared record view with `loadAccess`; UI controls use the ordinary permission helpers. Metadata is a display hint; writes still enforce current server predicates. Batch list action probes through the same native predicates rather than reconstructing ownership in DTOs.
- Read-only details must not depend on edit-only lookup access. Gate optional directory/configuration loads by their own Read permission; `optionalReference` can omit a denied optional lookup. Primary records and writes must still fail on authorization errors.
- Security administration, customer/personal access, financial transitions and configured leave approval relationships remain explicit business rules. Team membership alone grants neither an action nor approval authority. Do not add tenant-specific access overrides, role fallbacks or module-local permission aliases.
- Server entrypoints establish an authenticated tenant identity; frontend checks never authorize server work.
- UI should only hide/disable; server is source of truth.
- Tenant provisioning/lifecycle actions must use `canManageTenants` and remain restricted to platform admin users.

## Multi-tenant SaaS
- Appointments/booking orders use immutable native offices; children and linked appointments inherit their source. Bind captured office/version for new preflight and save; edits use their saved office. Validate new/expanded booking workplace coverage in tenant dates; hidden conflict and coupon usage checks require protected integrity projections. Bulk audits partition by office, and deferred constraints prove final operational/financial link coherence. See `docs/APPOINTMENT_OFFICES_R10.md`; booking staff choices use `modules/appointments/choices.ts` and `components/appointments/choice-picker.tsx`; inventory stock ownership remains pending.
- Workforce assignment choices use `modules/workforce/staff-choices.ts` and `components/workforce/staff-picker.tsx`, with captured office/version for new records and the saved office for edits. Search/count/paging and selected-label resolution must share the same eligibility/source scope. Retain saved assignees explicitly without certifying them as eligible for new assignments; never drop them through filtering. Shifts permissions do not delegate the generic directory. Roster drafts keep the clicked staff fixed. See `docs/WORKFORCE_STAFF_CHOICES_R10.md`; appointment staff choices follow `docs/APPOINTMENT_OFFICES_R10.md`.
- Roster browsing uses `modules/workforce/roster-read.ts` and its office/date-scoped staff page. Neutral live hours come from the protected projection; past minutes/bounds come from frozen history. Never reconstruct roster hours from optionally readable configuration or treat outside/unplaced/missing days as Off. Search/paging must preserve the same scope, and stale responses must not restore another page/date's data. See `docs/ROSTER_READ_R10.md`; assignment choices follow `docs/WORKFORCE_STAFF_CHOICES_R10.md`.
- Flexible weekly/recurring plans use immutable root offices and inherited child/audit boundaries. Capture creation context only for new records/clones; edits retain their source. Validate full dated-workplace coverage for new/expanded/activated windows. Preserve hidden-source timing through the protected adapter and keep clone audit identities within each office. See `docs/FLEXIBLE_PLAN_OFFICES_R10.md`.
- Daily slots/overrides use native immutable offices, captured context for new dates and source-office edits. Partition bulk audit arrays by office, retain slot IDs at matching positions and require Archive to clear the final slot. Use the protected dated-workplace projection for skip-weekoff selection; ordinary source Read cannot decide integrity timing or replace hidden sources. See `docs/DAILY_ROSTER_OFFICES_R10.md`; appointment staff choices follow `docs/APPOINTMENT_OFFICES_R10.md`.
- Operating companies/offices belong to the shared `platform/companies` directory, separate from control-plane `Organization`. Directory and membership administration are tenant-admin-only. R10 phase 2B adds native ownership and office RLS for sales roots and canonical children; direct account provisioning now accepts explicit memberships (see `docs/OFFICE_PROVISIONING_R10.md`); invitation onboarding uses the same transactional grants and fresh acceptance checks (see `docs/INVITATION_ONBOARDING_R10.md`); operational families, selectors and office controls remain release prerequisites. Directory placement and office grants never confer business actions. Capture creation context at form opening; linked records inherit their source office. See `docs/COMPANIES_COLLABORATORS_R10.md`, `docs/OFFICE_MEMBERSHIP_R10.md` and `docs/SALES_OFFICE_OWNERSHIP_R10.md` for the release contract.
- Tenant context is derived from host/subdomain (`lib/tenancy.ts`); API routes should use `requireTenantSession` (`lib/tenant-auth.ts`) for tenant-safe authorization.
- All tenant-domain reads/writes must filter by `tenantId`; avoid cross-tenant lookups even for internal helper queries.
- Database isolation is also enforced with Postgres row-level security (RLS) for tenant-owned tables.
- Tenant-scoped API/auth entrypoints must establish DB context through `lib/prisma.ts` helpers (`requireTenantSession`, `enterTenantDbContext`, `enterRlsBypassDbContext`) before issuing Prisma queries.
- Use RLS bypass context only for narrowly scoped platform/provisioning flows that intentionally cross tenant boundaries.
- All Prisma clients share one process-wide pool. The tenant adapter sets tenant, bypass and authenticated actor context transaction-locally, including for standalone queries; never introduce persistent session `SET` or a separate tenant pool. Supabase runtime uses transaction pooling; migrations retain their direct/session connection.
- After awaiting authorization, explicitly wrap database work in `runWithTenantDbContext` or (for authorized platform operations) `runWithRlsBypassDbContext`. An async helper's `enterWith` context does not propagate back to the awaiting caller; do not rely on it for subsequent route queries.
- Keep one shared database with strict tenant scoping in Prisma queries and model uniqueness constraints (`@@unique([tenantId, ...])` where applicable).
- Platform operations (tenant provisioning, status lifecycle, admin reset) are centralized under `/api/tenants*` and must validate platform-tenant scope (`PLATFORM_ADMIN_TENANT_SLUG`).
- Tenant management UI lives under `/settings/tenants` and is only visible/accessible for platform admin users.
- `/api/tenants` storefront listing excludes the `platform` control-plane tenant. Business tenants are provisioned explicitly and have no special default/fallback tenant.
- Use a dedicated platform tenant slug (recommended: `platform`). The obsolete `tenant_default` bootstrap record is removed by the retirement migration; do not recreate it in seeds or runtime code.
- Tenant admin profile management (name/email/phone/status/password) is handled via `/api/tenants/[id]/admin` and exposed from `/settings/tenants` row actions.
- Platform danger reset is handled via `/api/tenants/reset-all` (confirmation token required); preserve the configured platform-admin login tenant and allow optional platform-tenant preservation.
- Platform super-admin scope is provisioning-only:
  - allowed UI surfaces: `/settings/tenants` and `/settings/organizations`.
  - allowed API surfaces: `/api/tenants` and `/api/organizations`, including their child routes (plus auth/session endpoints).
  - block platform super-admin from domain modules/data routes (`/users`, `/services`, `/appointments`, `/inventory`, `/shifts`, `/leaves`, `/reports`, `/settings/*` except tenants and organizations).
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

## Operational service ownership
- Inventory mutations use `modules/inventory/transaction.ts`; refresh authority after shared/source locks and commit strict before/after audits with source, relation and stock writes. Use the shared `platform/transactions/tenant-operation.ts` lock for stock/scheduling/security coordination. New opening quantities and count corrections require signed movements. Stock is still tenant-wide until the atomic office-balance cutover; see `docs/INVENTORY_STOCK_R10.md`.

- Keep reusable order resolution, pricing and scheduling in `modules/appointments`; API routes are HTTP adapters and are not imported by domain modules.
- Use `modules/workforce/availability.ts` for staff working-time checks after endpoint authorization. Always supply the tenant ID and establish tenant DB context.
- Booking availability and plan guards use `modules/workforce/availability-blocks.ts` for private leave conflicts. Bind a real actor; the projection returns only unavailable dates and fails closed on lost authority. Hidden source rows or disabled Leaves must not make a staff member bookable. Do not return leave identifiers, classifications or reasons from availability. See `docs/SCHEDULING_PRIVACY_R10.md`; remaining operational office ownership is still a release prerequisite.
- Booking collisions use `modules/appointments/booking-integrity.ts` for private conflict flags/counts and paged busy intervals. Hidden appointments must still block bookings, leave approval, incompatible plan changes and scheduling-mode switches. Exclusion IDs must first be resolved through ordinary record access; source details for conflict resolution still require their own Read access and RLS. Keep locked final checks after advisory suggestions. Do not turn these integrity projections into record/assignment directories.
- Booking/plan working hours use `modules/workforce/working-time.ts`, not ordinary schedule, Flexible-plan or override queries. The protected projection preserves override and Flexible/Standard precedence without source identifiers, labels or off-day causes. Shared-template booking guards cannot derive affected staff only from visible sources. Native Standard schedules have immutable office ownership; defaults follow dated workplaces, never creation preferences. History is written only through the bounded canonical database writer, independently of source schedule Read. See `docs/EFFECTIVE_WORKING_TIME_R10.md` and `docs/STANDARD_SCHEDULE_OFFICES_R10.md`; Flexible/override and other operational ownership remains pending.
- Use `modules/inventory/stock-service.ts` for shared stock delta operations inside the caller's transaction. Appointments owns booking status effects and movement descriptions in `order-stock.ts`.
- Catalog-use authorization lives in `modules/services/policy.ts`; do not import the Services HTTP wrapper solely for that check.
- Inventory product/purchase rules live in `modules/inventory/{product-service,purchase-service}.ts`; call them within the inventory API's authorized tenant context. Reuse their projections, serializers and validation rather than copying query payloads into routes.
- Inventory category/supplier rules live in `modules/inventory/{category-service,supplier-service}.ts`; Services catalog/category rules live in `modules/services/{catalog-service,category-service}.ts`. Keep their shared field selections and service relationship validation in the owning module. Call these services with parsed input inside the existing authorized tenant context; route wrappers continue to enforce activation, permissions and audits.
- Purchase receipt updates lock the tenant-scoped purchase row before checking status and preserve cumulative received quantities. Keep line, stock and movement changes in one transaction.
- Dashboard query providers belong to their source modules and must skip domain queries when activation/read access fails. Cross-module response composition belongs in `application/dashboard`.
- Workforce leave definitions/groups, request rule/timeline helpers and notifications belong in `modules/workforce/leave-*`; shift template rules belong in `shift-templates.ts`. Supply tenant scope explicitly. Relationship replacement helpers must run in the caller's transaction; keep module/action access and audit wrappers at API entry points. PATCH validation must preserve omitted values rather than apply creation defaults.

- Leave request list/detail/submission and review/cancel/revoke/bulk workflows belong to `modules/workforce/leave-request-service.ts`. Routes retain parsing and HTTP conflict responses; `withWorkforceApi` retains module/action gates. Use conditional status writes, keep past roster updates in the status transaction, and report/audit/notify only rows actually changed by bulk review. Booking conflict enforcement remains active even when booking details are hidden by module/permission checks.

- Workforce leave-option/approved-list queries live in `leave-query-service.ts`; standard schedules/assignments live in `shift-schedule-service.ts`. Reuse their ordered projections and date/paging validation. All standard schedule mutations share the tenant-specific transaction lock; keep overlap checks, default replacement, block/assignment replacement and history capture inside that transaction. Displaced-default permissions and audit IDs are determined under that lock. Invalid staff selections must never broaden a query or silently save a subset.
- Leave requests have immutable office ownership and retain personal Read after transfer; reviewer access also requires the source office and configured approval relationship. Keep private roster evidence in `StaffRosterLeaveSnapshot`, with source RLS and canonical database hydration. Generic history must not contain private leave fields or reveal the leave cause. Use the shared creation-office snapshot on Apply leave; submit and audit under the scheduling transaction. See `docs/WORKFORCE_OFFICE_OWNERSHIP_R10.md`; other operational ownership remains pending.

## CRM interface
- Keep CRM page layouts within `pageClass`, with `AccessPageHeader` for the title, back link and actions. Use `Section` for named sections and `Surface` for list/filter panels. Embedded lists have section headings, not additional page headings.
- Place the primary save and navigation Cancel together in the page header with `AccessFormActions`. Associate the save button with its form ID. Keep independent actions (completion, notes and scheduling a reviewed plan) in that section's right-aligned `ActionBar`. Preserve confirmation dialogs for destructive actions.
- Use `Select` for fixed choices, `RecordSelect` for searchable server-backed records, and shared `Input`, `Textarea` and `Checkbox` controls. Retain labels, disabled permissions and required-field validation. Do not add visible native select controls in CRM.
- Keep search and the main status filter visible. Group additional filters in `Filters` with reset controls and an active-filter count.
- Use `TablePagination` with DataTable, or `Pagination` for reports, board columns and timelines. Show the record range on the left, centered Previous / Page / Next controls, and page size on the right. Narrow sections move centered page controls to a second row. Keep server-side paging and reset to page one when filters or page size change.
- Render customer interactions and record history through `Timeline`, with actor, event, timestamp and message. Keep internal-note forms within the history section.
- Shared presentation components live in `components/erp` and are imported directly. Permission-aware page actions, tabs and record editing live in `platform/access/{record-page,record-tabs,record-view}`. Use those access components for protected record views; do not recreate CRM alias files.
- Keep inline-size containment on the CRM layout boundary. The surrounding app shell is a flex item; wide tables and board columns must scroll inside CRM instead of expanding the document on mobile. Verify layouts within that shell as well as isolated previews.

## Record detail views
- Projects/subprojects use the shared `AccessRecordTabs`, `ReadOnlyFields`, `RecordMenu` and `EditPanel` from `platform/access/record-tabs.tsx` and `components/erp/record-detail.tsx`. Reuse these when adopting the pattern in other CRM records; do not copy panel/tab markup.
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
edit panel from section actions. Reuse Section for collapsible form sections
and DraftPanel for small configuration editors. See CRM_RECORD_VIEWS.md.


## ERP shared UI foundation (2026-10-03)

- Use `components/erp/page` for headers, surfaces, action bars, filters, toolbars and creation Save/Cancel controls.
- Use `components/erp/section`, `controls`, `pagination`, `record-select` and `record-detail` for common presentation.
- Neutral components must not import business modules or authorization hooks. Callers determine allowed actions and tabs; APIs enforce them.
- Permission-aware record components live in `platform/access` and consume the application route provider. Neutral `components/erp` presentation has no authorization dependency. Both are reused directly across modules.
- The focused edit-panel pattern supersedes the earlier dedicated-edit-page-only guidance when migrating large record views.

## Calendar dates and tenant timestamps

Use `useDateFormatter().formatDateOnly` for database DATE values, including
serialized midnight-UTC values. A leave date must not change with browser timezone.
Use `formatDateTime`/`formatTime` for instants, using the tenant date format,
locale, timezone and 12/24-hour setting. The hook shares one display-settings
request; do not fetch preferences per row. Its legacy `formatDate` method remains
for callers that intentionally supply browser-local Date objects.

Use `lib/business-time.ts` to convert an entered tenant wall time to an instant.
Reject nonexistent or ambiguous daylight-saving times rather than guessing.
Keep API persistence as UTC instants and use epoch arithmetic for durations.
CRM's work-time entry point re-exports these shared helpers for compatibility.


## Workforce daily roster ownership (R2(d), batch 7)

- Daily overrides, flexible slots and history queries belong to
  `modules/workforce/roster-service.ts`; routes parse input and return responses.
- Use `modules/workforce/roster-history.ts` with an explicit tenant ID. Database
  DATE values use UTC calendar arithmetic; use the business timezone only for
  appointment instants and the past-history cutoff. Never use server-local date
  getters for database DATE weekday, iteration or persistence.
- Daily roster saves/deletes and history changes share a transaction. Use
  `schedule-transaction.ts` for standard schedules/assignments and daily roster
  writes; weekly/recurring plans and standalone appointment creation also participate.
  Appointment edit/cancel/bulk resolution also participate; order writes, leave
  transitions and staff-mode writers still need coordination.
- Keep unrelated/skipped history snapshots unchanged and retain permission-based
  appointment conflict redaction. Missing or foreign staff filters must not widen
  a query to the full tenant roster.


## Flexible scheduling ownership (R2(d), batch 8)

- Use `modules/workforce/flexible-plan-service.ts` for weekly plans and recurring
  list/detail/save/clone/deactivate operations. Shared projections and nested
  day/slot/break creation live in `flexible-plan-record.ts`; preview calculations
  and query/clone/preview validation have separate owning-module files.
- Weekly and recurring writes use `schedule-transaction.ts`. Only an edit excludes
  itself when checking active overlap; a clone must include its source. Check
  actual activation/displacement permissions while holding the transaction lock.
- Keep displacement audits in the same transaction. Clone audit entity IDs must
  identify the created destination, retaining source context in the before data.
- Preview is advisory and must validate draft cycles with save rules. Its date
  horizon is inclusive and appointment counts use business-local boundaries.
  It does not authorize or perform appointment cancellation/rescheduling.


## Appointment service ownership (R2(d), batch 9)

- List/create and availability rules live in `modules/appointments/appointment-service.ts`.
  Use shared projections/serialization from `appointment-record.ts`; detail adds
  service price without changing the list contract. Routes retain parsing and
  existing Appointments/Services gates.
- Date filters are business calendar dates. Validate real ordered dates, convert
  through the tenant timezone and use an exclusive next-day upper bound. Keep
  paged database queries and a deterministic ID tie-breaker.
- Standalone create uses the shared Workforce scheduling transaction. Supply its
  transaction client to availability checks; never leave the transaction connection
  for those reads. Preview is advisory and must validate excluded record ownership.
- Appointment edit/cancel/bulk resolution now participate too. Do not assume the
  lock covers order writes, leave approval or staff-mode changes until those paths
  explicitly participate.


## Appointment mutation ownership (R2(d), batch 10)

- Use `modules/appointments/appointment-mutations.ts` for detail/edit/cancel/bulk
  resolution. Keep current-row permission checks, conflict checks, conditional
  writes and audits inside the scheduling transaction. Use the caller's database
  connection for Services policy and Workforce availability reads.
- Reactivation is a scheduling action even if only status changed. Recheck working
  hours and staff/customer overlap. Preserve saved duration on a move unless the
  selected service changes; bulk moves retain exact relative offsets.
- Bulk selections are bounded to 100 IDs and reject missing/foreign records as a
  whole. Validate proposed slots against each other as well as existing bookings.
  Unchanged selected rows must not be excluded from conflict checks.
- Mutation audits are transactional. Count/audit only changed bulk rows and keep
  cancellation idempotent. Order synchronization and nonparticipating writer races
  remain tracked work, not guarantees supplied by the appointment lock alone.


## Booking order creation ownership (R2(d), batch 11)

- Order list/create live in `modules/appointments/order-service.ts`. Keep the route
  as a parser/response adapter and reuse projections and the pricing resolver.
- Resolve confirmed scheduling suggestions outside the write lock; re-resolve all
  authoritative inputs on the scheduling transaction client and recheck the proposed
  slots inside it. Never run the multi-day suggestion search inside this transaction.
- Persist order lines, appointments, stock and create audit together. Do not add a
  second post-commit wrapper audit. Convert known validation/stock conflicts into
  business errors; let unexpected database failures produce the shared safe 500.
- Shared stock deductions use a conditional balance predicate and stable product
  write order. All callers must keep movements and source records in the same
  transaction. Do not replace this with a read/check/unconditional decrement.
- Order editing and other nonparticipating writers are tracked separately; a locked
  create does not establish end-to-end consistency with those paths.


## Order edit ownership (R2(d), batch 12)

- Detail/edit belong to `modules/appointments/order-mutations.ts`. Preserve saved
  line and appointment IDs. Saved line IDs must belong to the scoped order and be
  unique; omit temporary browser IDs for new rows. Use shared line projections.
- Never delete a line with appointment history or delete/recreate appointments on
  ordinary saves. Retain terminal appointment states and block replacement of
  started/completed/no-show scheduling details. Do not infer whole-order status or
  product restocking from one appointment's cancellation.
- Use the shared scheduling transaction for final coupon/availability checks,
  status/stock changes and strict edit audits. Check archive permission both before
  preflight and against the locked current status. Treat changed preflight
  snapshots as conflicts. Repeated status-only commands make no additional writes.
- Metadata/status-only edits preserve saved prices and durations. Repricing is an
  explicit financial edit. Historical/orphan repair is a release reconciliation
  task, not a heuristic in a runtime editor.
- Booking forms convert tenant wall time with the shared business-time helpers.
  Never combine a saved business date with browser-local clock getters. Keep
  invalid partial-input handling safe and expose the timezone beside time input.

- Appointment coupons live in `modules/appointments/coupon-service.ts`; coupon mutations
  and order coupon use share the tenant scheduling transaction. Preserve PATCH
  omissions and validate merged date/discount rules. Save coupon audits atomically;
  never rename used codes or delete referenced coupon history. Count usage from
  non-canceled tenant orders with database aggregates, excluding the edited order.
- Appointment invoice delivery/rendering lives in `modules/appointments/invoice-*`.
  Export and email share saved order prices, product/service lines and tenant time.
  Email additionally requires edit permission; delivery auditing is best effort after
  SMTP succeeds because the external send cannot participate in a database rollback.

## Booking taxes and time (R2(d), batch 14)

- An explicit zero unit price is a quoted free item. Do not replace it with the catalog
  price. Omitted tax IDs use catalog defaults; an empty list means no tax. Validate
  all resolved tax IDs within the tenant and reject unavailable selections.
- Preserve inclusive gross amounts when no coupon changes their net base; reconcile
  tax breakdown cents to line tax totals. Keep database Int amount limits explicit.
- Scheduling/status-only resolution can use the order's own saved tax definitions;
  financial edits resolve current active taxes. Never accept client tax snapshots.
- Use `modules/appointments/order-time.ts` for consistent business date/time/instant
  validation and partial scheduling edits. Return only time fields from time merging,
  so unrelated PATCH fields cannot be overwritten. Preserve metadata-only history.


## Booking pricing previews (R2(d), batch 15)

- `POST /api/appointments/orders/preview` is a read-only Appointments operation.
  Resolve current prices/coupons with the same owning-module resolver as saving;
  do not duplicate coupon/tax arithmetic in browser components. Require the same
  catalog/module permissions for financial changes. Validate the tenant-owned
  order before excluding its existing coupon usage.
- Previewing must not reserve slots, consume stock/coupons, create audits, send mail
  or acquire the scheduling write lock. Saving still revalidates in its transaction.
  Unchanged financial inputs use saved snapshots, even if catalog taxes change.
- Preview and save share form payload construction. Debounce requests, cancel obsolete
  requests, hide obsolete totals and prevent saving until the current preview succeeds.
  Network/validation failures are explicit; do not fall back to zero or stale totals.
- Display the net subtotal after line discounts as total minus tax plus coupon
  discount. Line discounts are informational (already included); subtract coupons
  and add tax once. This reconciles mixed inclusive/exclusive saved orders without
  rewriting history. Invoice rates are saved quoted unit prices; mark inclusive
  items instead of subtracting discounted line tax from their original unit prices.

## Scheduling and transaction completion (R2(d), batch 16)

- Reject adapter queries after transaction completion begins. Prisma may continue
  a nested query chain after an interactive timeout queues rollback; it must never
  run outside its transaction-local tenant scope or use a released connection.
- Write flexible plans with parent-first bulk inserts per hierarchy level, inside
  the existing transaction. Keep RLS, ordering and replacement rollback intact.
- Leave review/cancel/revoke and bulk review share the booking scheduling lock.
  Recheck current status and record scope after acquiring it; approve only after
  checking conflicts using tenant-calendar day boundaries. Use the transaction
  client for permission reads, history and strict audits. Notify after commit.
- Known transition errors use BusinessError; unexpected database/audit failures
  must use the common safe server response. Staff-mode writers and plan-change
  history/booking effects remain tracked follow-ups, not guarantees of this batch.

## Staff scheduling-mode changes (R2(d), batch 17)

- User edits acquire the scheduling transaction before user-security tenant row
  locks. Delegate mode validation/write/audit to `staff-scheduling-mode.ts` and
  use its transaction client. Recheck role/module access after waiting.
- Evaluate current/future plan cutoffs using the tenant's calendar day and Monday,
  keeping database DATE values as UTC calendar dates. Do not delete old plans or
  rewrite historical roster snapshots when changing mode.
- Block mode changes until active/future bookings are resolved explicitly through
  Appointments, including overdue appointments still in progress. Keep conflict
  responses free of customer details. An unchanged mode needs no additional module
  activation or audit. Return freshly saved profile/eligibility details after edits.

## Flexible availability and history (R2(d), batch 18)

- Use `loadWorkingTime` for live booking checks and plan-booking guards. Flexible
  timing selection reuses history's private canonical SQL helper; do not derive
  integrity hours from ordinary source queries. Keep approved leave above the
  working-time projection and overrides above Flexible/Standard sources. Explicit
  off days suppress fallback; empty non-off days retain the existing fallback.
- Recurring cycles start at validFrom, using UTC calendar-date arithmetic. Deduct
  breaks with the shared working segments. Keep the existing Flexible history
  label/source; insert-missing captures must never rewrite saved snapshots. An
  explicit replace operation remains limited to its authorized affected dates.


## Standard availability and history (R2(d), batch 19)

- Use loadStandardAvailability for live booking checks and Standard history. Verify
  profile ownership before applying the tenant default; range-load assignments and
  schedules, never query per staff/date. Cache each schedule's rotation once per
  range. Flexible-only history must not load Standard schedules.
- Use standard-schedule.ts for authorized configuration previews. Live roster
  display uses the protected roster read boundary; booking checks use protected
  working time. Rotation is
  anchored to schedule.startDate; assignment dates only bound applicability. Use
  the default on unassigned dates, including gaps, but never on an assigned off day.
  UTC DATE arithmetic keeps cycles independent of server timezone/DST. Convert
  browser calendar dates by their displayed date keys before calling these helpers.
- Secondary week-off rules with an empty week list mean all weeks, matching schedule
  save normalization. Use stable latest-start/ID assignment precedence. Share
  workingSegments for live checks, paid minutes and roster display; clip breaks and
  subtract overlapping pauses once. Keep leave/override precedence and preserve
  existing history snapshots during insert-missing captures.


## Flexible plan mutations (R2(d), batch 20)

- Use flexiblePlanTransaction for weekly/recurring writes. After acquiring the
  scheduling lock, reread role, tenant status, module activation and permissions;
  use the refreshed actor for displacement/status-transition authorization.
- Compare effective Flexible availability before/after changes with
  protectFlexiblePlanBookings. Reject newly invalid active/future appointments
  with 409; never silently move/cancel them. Include overdue in-progress work and
  bookings outside a replacement's range when it retires another pattern. The
  preview horizon is advisory only and must not cap mutation safeguards.
- Page candidate appointments, batch plan/leave/override reads, preserve higher
  priority sources, and return conflicts without customer details. Pre-existing
  unrelated conflicts must not block compatible changes or inactive drafts.
- Save strict before/after audits with the plan write. The API wrapper must not
  duplicate these snapshots/audits. Repeated deletion/deactivation is a no-op.
  Do not rewrite historical roster snapshots incidentally; explicit historical
  plan corrections remain a separately scoped follow-up.


## Shared plan safeguards (R2(d), batch 21)

- `planTransaction`, `auditPlan` and `protectPlanBookings` are the shared helpers
  for Standard schedules, assignment endings, shift templates and Flexible plans.
  They replace the flexible-only helper names from batch 20; no alternate runtime
  path remains. Recheck module/role/permissions under the common scheduling lock.
- Schedule mutations protect the union of previous and new assigned staff; any
  default change protects all Standard staff in the tenant. Assignment endings
  require archive permission. Schedule saves recheck template-read permission.
- Shared template changes must check both Standard schedules and overrides used by
  either scheduling mode. Compare actual effective availability, including breaks,
  leave and override precedence. Do not suppress already-assigned hours just
  because a template is inactive; deactivation affects normal template selection.
- Candidate booking reads use scoped keyset pages; source reads are batched and
  use the existing Standard/Flexible resolvers. Never return customer details in
  a plan conflict. Protect valid bookings only; unchanged invalid bookings do not
  block repairs. Do not move or cancel bookings implicitly.
- Capture missing old roster history before replacing schedule/template definitions;
  preserve saved snapshots. Template deletion checks schedules, overrides and saved
  history inside the transaction. Referenced templates can be deactivated instead.
- Main and default-displacement audits must commit with the write. Services own
  snapshots/audits for templates, schedules and assignments; the API wrapper must
  not duplicate them. Repeating the same assignment end date produces no new audit.
- Daily override/slot mutation guards, explicit historical corrections and reverse
  appointment/order synchronization remain separately tracked work.

## Daily roster mutations (R2(d), batch 22)

- Overrides and daily Flexible slots use `rosterMutation` / `planTransaction` for
  saves and deletes. Recheck role, tenant/module activation and permissions after
  acquiring the common scheduling lock. Template references require fresh read
  permission; slot saves recheck Flexible mode after waiting.
- Use `protectPlanBookings` with the affected dates. It limits candidate reads by
  a padded UTC range, then filters exact tenant dates and compares shared effective
  availability. Overrides apply to either mode; daily slots affect Flexible mode
  only. Respect weekly/recurring/override/leave precedence on both sides.
- Protect valid future scheduled/confirmed and all in-progress bookings, including
  overdue work. Compatible fallback and edits beneath a higher-priority source
  are allowed. Pre-existing invalid records must not block unrelated repairs.
- Throw `PlanBookingConflict` inside the transaction so tentative writes roll back.
  Only afterward may the roster helper resolve its internal IDs into the existing
  conflict-response shape. Recheck Appointments disclosure access and load details
  only when authorized, in batches. Other plan APIs expose only the safe message.
- Save before/after audit snapshots with the roster/history write. Services own
  these audits; the API wrapper must not duplicate them. Empty deletions and fully
  skipped ranges do not emit mutation audits. Past daily corrections keep their
  established replace-only-affected-dates behavior; skipped dates remain untouched.
- These endpoints never resolve bookings implicitly. The user's separate explicit
  resolution action still goes through Appointments and its own access checks.

## Historical Flexible plan changes (R2(d), batch 23)

- Before mutating an existing weekly plan or active recurring pattern, call
  `captureFlexiblePlanHistory` inside the scheduling transaction, while the old
  effective sources still exist. Capture the old validity range, not only new dates;
  active replacement/clone displacement includes the entire displaced range.
- Capture only tenant-scoped Flexible staff and past dates through tenant yesterday.
  Merge overlapping/adjacent ranges, preserve gaps and bound source reads/inserts
  to 366 dates per batch. Use insert-missing so saved snapshots remain immutable.
  Drafts and currently dormant Standard-mode plans do not create snapshots here.
  Creating a new backdated plan may populate missing history, never overwrite it.
- Deliberate historical corrections continue through daily override/slot and leave
  workflows. Replace only selected dates, preserving source precedence, booking
  safeguards and strict atomic audit. A failed capture, guard or audit rolls back
  both plan changes and newly captured history.
- Past roster display must use saved bounds and paid minutes. Do not reinterpret
  history using current template hours/breaks. Exact historical break layout is not
  stored; do not invent it. Current/future periods continue using live segments.

## Appointment/order synchronization (R2(d), batch 24)

- All appointment/order create and edit writers, cancellation and bulk resolution
  use `appointmentTransaction`. Recheck active user/tenant, role, module and
  action permissions after the shared scheduling lock; pass the fresh actor to
  catalog/inventory and status-transition checks. Standalone creation audits must
  commit in the same transaction as the appointment.
- Call `synchronizeAppointmentOrders` for changed linked appointments before
  committing single/bulk mutations. Scope parent/line reads to the tenant and
  affected line IDs; detect ambiguous links with at most two linked IDs per line.
  Keep API batches bounded to 100 selected appointments. Unlinked changes skip
  order reads. Do not introduce per-appointment parent lookup queries.
- Staff/time edits update only linked service-line scheduling fields and saved
  duration. The header reflects the earliest retained service-line start, including
  historical lines, and the tenant-local date. Never implicitly move siblings.
  An unchanged service ID must preserve quantity-based/saved duration.
- Linked customer/service changes go through the order editor. Reject replacement
  of started/completed/no-show schedules and activation under an unconfirmed order.
  Fail closed on missing/foreign/ambiguous links; do not silently repair records.
- Appointment cancellation/completion does not infer order status or mutate
  financial snapshots, coupon usage or stock. Those require explicit order actions.
  Touch the parent revision for changed linked appointment statuses and write
  `appointments.order.appointments_updated` with before/after schedules and linked
  appointment snapshots. Appointment and order audits must roll back together.

## R2 completion review

- Coupon writers use `appointmentTransaction` with the `appointmentCoupons`
  resource. Keep coupon permissions separate from booking permissions, and use
  the refreshed actor for archive/status and catalog-reference checks after waiting.
- Operational API routes remain HTTP adapters; owning modules contain database and
  business rules. The architecture suite rejects direct database access in these
  adapters and operational modules importing route implementations.
- Database fixtures for CRM core and imports use `TenantPgAdapter` with explicit
  tenant or local-root scope, matching runtime transaction-local RLS. Do not model
  application isolation only through persistent connection options in new tests.
- R2 local completion does not change the R5 release gates. Historical migration
  fixtures requiring older schemas remain explicit pending checks, never passes.

## Custom-field ownership (R3(a))

- Register code-owned resources in `application/custom-fields/resources.ts`.
  Shared scopes must use the same owning module and context policy. Do not accept
  table names or executable providers from tenant configuration.
- Resource context policies validate form and definition requests inside the
  caller's transaction. CRM owns team/membership checks; Real Estate owns project
  context restrictions. Enforce module dependencies before loading definitions.
- Supply explicit batched record-context queries from the owning module for
  exports. Never infer a domain table name from the field-value table name, or
  fetch context once per row. Call only for already-authorized records.
- Reuse `components/erp/custom-field-control.tsx` for typed field inputs. Preserve
  saved labels/options and required cohorts; cosmetic refactors must not change
  field identities, types, stored values, audit identities or historical snapshots.

## Tenant terminology (R3(b))

- Modules contribute code-owned term definitions to `application/terminology`.
  The platform owns validation, resolution and persistence; it never imports
  business catalogs. Only allowlisted keys can be changed by tenant administrators.
- Read labels as a tenant snapshot and reuse the map; never query configuration
  per record or keep an unversioned global cache. Module dependencies gate results.
- Saves share the tenant lock with module settings and use ReadCommitted so access
  is checked against fresh data after waiting. Compare the configuration version,
  reject collisions against effective defaults and fixed controls, and commit
  overrides, version and the required audit together. Reset preserves audit history.
- Labels never change keys, permissions, types, mandatory integrity constraints,
  import identity or historical document snapshots. Consumer integrations must
  preserve their contextual default wording and explicitly document coverage.
- Screen consumers use `useTerminology()` with an explicit semantic key, exact
  contextual fallback and optional `{label}` template. Never perform global text
  replacement or use configured text as routing, access or form identity.
- Configurable accordion/summary titles must have a stable `sectionKey` matching
  the form initial section. Changing labels must preserve drafts and open sections.
- Reuse the protected-layout provider; do not fetch terminology in each widget or
  row. Keep fixed admin configuration labels discoverable for resetting overrides.
- Custom import captions keep the literal field name separate from its code-owned
  scope metadata. Resolve scope wording at presentation time; never interpolate
  user field names as templates or rename CSV codes, mappings or stored errors.
- Annotate record-name errors with code-owned TermText metadata. Keep canonical
  messages/status and Zod paths unchanged; resolve presentation only after the
  failed transaction rolls back. Never replace substrings in arbitrary errors,
  stored audit text or correction rows. Presentation failure retains the original.
- Async client fallback errors use useTerminologyReader when a changing resolver
  would restart record-loading effects. Rendered labels use useTerminology;
  label changes must not refetch records or overwrite unsaved drafts.

## Industry view composition (R4)

- Shared WorkList accepts code-owned extension query text, guidance and action
  visibility. Owning modules construct industry filters and gate mounting by
  activation/access. The server validates query fields and scope independently;
  never treat a hidden action or supplied query as authorization.
- Use stable serialized filters for list effects; terminology changes must not
  refetch records. Key embedded lists by context when changing it should reset
  pagination. Reuse the shared list rather than copying filters or table markup.
- Sales Documents renders label/value context supplied by its provider without
  assuming an industry. Existing saved context and content remain visible from
  immutable snapshots even when the addon is disabled; new context obeys activation.
- Shared sales lists serialize extension filters through useCrmExtensionFilterQuery;
  export requests must reuse the same query. The owning module interprets industry
  URL references; application composition passes them to generic editors.
- Keep module refreshes atomic without unmounting unchanged authorized views.
  Initial loading and failed/revoked access remain guarded. Never rely on a cached
  UI permission for a write; enforce current activation/access in the server.
- Editor load callbacks depend on the stable extension load function. Unrelated
  optional panels must not trigger a record reload or overwrite a draft.
- Custom-field resources supply code-owned scope labels and context capabilities.
  Return presentation only for available resources; resolve terminology in the UI.
  Never infer an industry's rules from scope identifiers in shared controls.
- Shared CSV controls require an explicit access requirement. Owning screens
  compose report and record permissions; never derive authorization from URL text.
  Server exports independently check permissions and apply the same filters.
- Preset definitions and business queries belong to their owning modules;
  application code composes catalogs. Keep stable preset/item identities when
  moving code so existing configuration is not duplicated or overwritten.
- Project import choices require project-read permission before catalog queries.
  New/changed project selections enforce the same permission on the server.
  Linked context on an accessible CRM record remains evidence, not browse access.

## Release reconciliation

- Use the reviewed industry-release manifest and local-only snapshot tooling for
  R5 rehearsal. Never regenerate checksums or mark failed migrations applied to
  silence a discrepancy. Compare actual target history and baseline schema first.
- Keep reconciliation consistent and read-only; persist aggregate fingerprints,
  not customer rows. Test release SQL on isolated fixtures, and distinguish those
  results from a restored-client upgrade. Full runtime RLS, assets, grants and
  protected backup/restore checks remain separate mandatory release gates.
- Reconciliation identities may use primary keys or non-null, immediate unique
  index keys covering every row. Reject nullable/partial/expression/deferred keys.
  Order identity JSON using the `C` collation; bump snapshot format when changing
  fingerprint ordering so old and new evidence cannot be silently mixed.
