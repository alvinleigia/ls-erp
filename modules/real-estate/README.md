# Real Estate sales extension

Optional `realEstate` module, requiring CRM. Project records are property
developments, not SaaS tenants, inventory, reservations or delivery projects.
The module owns the project/subproject catalogue, staff assignments and property
context linked to shared CRM enquiries/opportunities. Conversion preserves that
context; project sales views and sales-report filters are implemented.

`service.ts` rechecks current membership, module flags and record scope on every
operation. Callers must establish tenant database context. Writes and audits are
atomic; edits require a version. No hard-delete operation is exposed.

See `docs/CRM_SALES_PHASE_3.md` and `docs/CRM_SALES_PHASE_4.md` for delivery records.
The active refactor sequence is `docs/CRM_ODOO_ALIGNMENT_PLAN.md`. Phase 1's
extension boundary is implemented: `crm-extension.ts` owns the server adapter and
`components/crm-extension.tsx` owns the CRM view adapter. Application composition
installs both. Phase 2 adds configurable project statuses, shared property categories
and buying timeframes under CRM Configuration. Typed catalogs, defaults, archived
selection preservation and label snapshots are implemented; see
`docs/CRM_ODOO_PHASE_2.md` for the migration and verification. Additional fields
remain planned.

Multi-level structure is implemented by the P13S hierarchy foundation. Each node
can have children; company, team, membership and sharing inherit from the root.
Use `hierarchy.ts` rather than assuming `parentId` is the root. Launch phases are
separate from structural nodes. See `docs/PROJECT_HIERARCHY_P13S.md`.

`launch-phases.ts` manages root-owned launch phases and supplies the catalog's
batched reservation admission hook. Unit assignment is explicit; only new holds
are gated. Existing allocations, payments and commercial snapshots are retained.
See `docs/PROJECT_LAUNCH_PHASES_P13S.md` for configuration and migration details.
