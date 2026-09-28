# Real Estate sales extension

Optional `realEstate` module, requiring CRM. Project records are not SaaS tenants,
inventory or reservations. Phase 3 exposes the catalogue and staff assignments;
Phase 4 will connect it to shared CRM enquiries/opportunities.

`service.ts` rechecks current membership, module flags and record scope on every
operation. Callers must establish tenant database context. Writes and audits are
atomic; edits require a version. No hard-delete operation is exposed.

See `docs/CRM_SALES_PHASE_3.md` for behavior, migration, verification and rollout.
