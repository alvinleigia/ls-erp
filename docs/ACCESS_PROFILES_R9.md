# R9: composable module access profiles

Current implementation: local `staging`, with migrations 108–110 pending hosted
release. See [standardization contract](ACCESS_STANDARDIZATION_R9.md) for evidence
and deployment requirements.

A user may combine profiles such as CRM Manager and Inventory Viewer. Active
profiles add permissions. Removing a permission from one profile does not revoke
it if another active profile still grants it. Each resource requires Read before
its other actions. Staff and Manager users without profiles have no business
permissions. Disabled or archived profiles contribute nothing.

Record limits belong to the user, separately for each resource and action. For
example, Enquiries Read = All and Edit = Own allows inspection of all enquiries
but editing only direct assignments. Read = Own and Edit = All still permits
editing only those readable own enquiries. Assignment and archive are separate
permissions with their own limits. Profile changes never widen record limits.

Tenant administrators retain tenant authority and manage security configuration.
Staff/Manager account labels otherwise use the same permission model. A Manager
profile does not automatically designate a team manager or reporting manager.
Customer accounts use their separate personal entrypoints.

## Configuration

1. Open **Settings > Access profiles > New profile**.
2. Choose a module and copy a Viewer or Manager template. Review its action
   checkboxes, name it and save. Templates are editable starting points.
3. Choose **Assign profiles**, select a user and combine the required profiles.
4. Expand the resource sections and set its per-action record limits. Only
   supported scopes are offered. Save using the current policy version.
5. User creation provides the same profiles and record-limit controls.

New users receive the registered conservative defaults, but those defaults grant
no actions without profiles. Unknown/new permissions are denied for existing
users until an administrator deliberately configures them. Assignments and rules
save atomically with audit history and optimistic concurrency checks.

## New module checklist

- Register the module, permission resources, supported scopes and defaults.
- Compose permissions through the shared resolver and authorize current identity
  inside the business transaction.
- Implement one resource predicate used by every query path, including secondary
  actions and source lookups. Shared reference data supports All/None unless it
  has a real ownership relationship.
- Return per-record action metadata and reuse shared UI access components.
- Test tenant isolation, delegated Staff, read/action intersections, revocation,
  related-source privacy and failed-write rollback.
- Migrate existing policies explicitly when granting a new capability is needed;
  never add a runtime legacy or tenant-specific fallback.
