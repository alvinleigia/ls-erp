# R10 current resource boundary inventory

Phase 2D7B audit/report inventory, now backed by the exhaustive executable
resource/model contracts in `platform/access/resource-registry.ts` (phase 2D7C).
Native ownership and source policies remain authoritative. See
`RESOURCE_OWNERSHIP_R10.md` for consumers, admission checks and the workspace UI
readiness review. This inventory does not authorize workspace UI.
Every future module must classify roots, children, shared references, personal
access, integrity projections, audit copies and composed consumers together.

| Resource/family | Ownership/access boundary | Source contract |
| --- | --- | --- |
| Companies, offices, memberships/preferences, users | Tenant security directory and explicit memberships; company placement grants no action | `COMPANIES_COLLABORATORS_R10.md`, `OFFICE_MEMBERSHIP_R10.md` |
| Teams and team membership | Shared business directory with designated per-action authority; no office or approval grant | `ACCESS_MODEL_R9.md` |
| Enquiries, opportunities, activities, imports, plan launches | Immutable native office roots, explicit owner/team rules, selected sharing and Restricted visibility | `SALES_OFFICE_OWNERSHIP_R10.md` |
| Projects/subprojects and membership | Project root office; subprojects/membership/units inherit sources; Real Estate is an add-on | `SALES_OFFICE_OWNERSHIP_R10.md` |
| Quotations, revisions and document versions | Opportunity source; saved financial/document identity retained | `SALES_OFFICE_OWNERSHIP_R10.md` |
| Sales orders, receivables, lines, payments, allocations, reversals | Canonical quotation/order source ancestry; no independent office override | `SALES_OFFICE_OWNERSHIP_R10.md` |
| Catalog items/reservations | General items shared; add-on units inherit project; reservations intersect item and order sources | `SALES_OFFICE_OWNERSHIP_R10.md` |
| Contacts and business accounts | Deliberately tenant-shared parties, bounded by existing own/related/managed and Restricted policies | `RECORD_SHARING_R9.md`, `SALES_OFFICE_OWNERSHIP_R10.md` |
| Typed/custom values and restricted fields | Canonical parent source, field permission and source office/sharing; configuration is separately controlled | `SALES_OFFICE_OWNERSHIP_R10.md` |
| Pipelines, sources, lost reasons, activity types/plans, rules, presets, templates, property choices | Shared module reference/configuration data; saved launches/work never inherit broad configuration access | `ACCESS_STANDARDIZATION_R9.md` |
| Inventory products | Split shared catalogue definition and private office stock/cost/reorder balances | `INVENTORY_STOCK_R10.md` |
| Categories, suppliers, services, packages/service categories, coupons, tax, branding and labels | Shared configuration/catalogue, bounded by resource Read and module activation | `CONVENTIONS.md`, `INVENTORY_STOCK_R10.md` |
| Purchases, receipt allocations and stock movements | Immutable purchase office; canonical cumulative posting and source-only financial projections | `INVENTORY_STOCK_R10.md` |
| Appointments, booking orders, child service/product/coupon/tax lines, invoice snapshots | Saved booking office and canonical child ancestry; retained financial projections independent of optional catalogue browsing | `APPOINTMENT_OFFICES_R10.md`, `INVENTORY_STOCK_R10.md` |
| Leave requests, approvals, private history | Native saved office plus personal/reporting-approval relationships; hidden leave still blocks integrity timing | `WORKFORCE_OFFICE_OWNERSHIP_R10.md` |
| Leave definitions/groups and shift templates | Deliberately shared module configuration; employee eligibility and approval authority are separate | `CONVENTIONS.md` |
| Staff workplace placement and Standard working time | Dated personal placement/working-time sources; separate from account office grants | `STAFF_WORKPLACES_R10.md`, `STANDARD_WORKING_TIME_R10.md` |
| Standard schedules/assignments/blocks | Saved schedule office, dated staff coverage and canonical inherited children | `STANDARD_SCHEDULE_OFFICES_R10.md` |
| Weekly/recurring plans and daily slots/overrides | Saved root office, canonical children and private integrity projections | `FLEXIBLE_PLAN_OFFICES_R10.md`, `DAILY_ROSTER_OFFICES_R10.md` |
| Roster Read and staff/office assignment choices | Explicit readable source office/date scope; no generic directory delegation; retain saved selections without certifying new eligibility | `ROSTER_READ_R10.md`, `WORKFORCE_STAFF_CHOICES_R10.md`, `APPOINTMENT_OFFICES_R10.md` |
| Dashboard, activity/sales reports and exports | Composition of current readable sources; filters only narrow; module-off widgets absent | `CONVENTIONS.md`, `ACCESS_STANDARDIZATION_R9.md` |
| Coupon report | Customer population derived from readable non-canceled saved bookings, not the whole directory | `REPORT_OFFICES_R10.md` |
| Composed audit list/details | Closed event registry, current family actions/modules and native snapshot source/privacy intersection; no export endpoint | `AUDIT_REPORTS_R10.md` |
| Conflict, stock and reservation integrity | Protected neutral projections/commands enforce business integrity without exposing hidden source details | `SCHEDULING_PRIVACY_R10.md`, `INVENTORY_STOCK_R10.md` |

The consolidated contracts retain native canonical source adapters and introduce
no runtime exceptions. Complete and verify membership/provisioning/workspace
controls and the recovery/release gates before hosting these phases.
