# R10 phase 2D7C: executable ownership contracts and workspace readiness

Implemented locally on `staging`. No migration, backfill, permission rewrite,
hosted change, push or deployment is included. The workspace selector remains
gated. The [office-membership editor](OFFICE_MEMBERSHIP_UI_R10.md) is now
implemented locally in phase 2D8A.

## One registration contract

`platform/access/resource-registry.ts` registers all **50 permission resources**.
Each contract supplies its existing record-policy family and classifies its
canonical models as shared, security, native office, inherited source, personal,
composed or explicitly split. Roots/children use generated Prisma model names.
Source references use registered resource keys. All **131 Prisma schema models** must be represented by a resource contract or one of 11 explicit
infrastructure classifications (authentication, tenant boundary/security,
control plane or source-sharing security). Adding a model/resource without
reviewing its classification fails TypeScript and admission checks.

A model can participate in more than one view: a personal leave request and an
approval view share a source; a dashboard composes existing roots. This does not
grant access to all fields or rows of that model. Infrastructure classification
also grants no query or bypass permission.

The existing public policy map is now derived from this registry. There is no
second static scope map or runtime migration fallback. Existing record limits,
profile permission arrays, module activation, responsibility/team rules,
Restricted sharing and tenant boundaries are unchanged. Source references explain
**ownership**, not an automatic requirement to browse a parent directory and not
a grant to its records. Personal approval and neutral integrity projections keep
their dedicated existing adapters.

## Executable consumers

- The scope engine consumes the derived policy families. Supported choices and
  defaults retain their previous values; missing rules still deny access.
- Selected-record sharing resolves canonical owners from the contracts. Its
  actual record model/table and module also come from the same registration.
  Presentation fields remain explicit for supported record types. Finance and
  project-membership aliases retain their previous canonical owners.
- Simple audit families derive their resource Read, owning module and boundary.
  A split resource requires an explicit component: Inventory stock cannot fall
  back to shared catalogue history. Composed/security exceptions remain explicit
  in the closed audit registry, with unchanged audiences and requirements.
- Profile/record-limit controls display the ownership description. `ALL` is
  labelled **All accessible records**, rather than implying an office or sharing
  bypass. Its stored enum value remains `ALL`. Company-directory copy separates
  membership, business actions and employee workplace placement.

Inventory products explicitly split shared catalogue, office stock/movements,
booking allocations and purchase allocations. Catalog items distinguish general
items, project-backed units and bounded availability. Roster registration separates
office-owned daily changes, personal frozen history, dated placements and composed
browsing. Financial records keep their canonical source chain.

The registry is not a generic SQL builder. Native RLS, immutable office identity,
canonical FK ancestry, source adapters and business transitions remain the
server/database authority. In particular, model registration never permits a
client to choose a table or submit ownership metadata as authorization.

## Admission and preservation checks

`tests/fixtures/resource-contract-baseline.json` freezes the reviewed pre-refactor
scope families, sharing definitions/aliases and audit requirements. It contains
code metadata only, with no tenant rows or credentials. It is not imported by the
application and must not be regenerated to silence a failure.

`test:resource-contracts` combines registry/schema admission, action policies,
profile composition, selected sharing and composed-audit regression tests in a
disposable database. Schema checks require forced RLS for every registered
business model, non-null office/FK identity for native office roots, and actual
FK ancestry for inherited sources/children. Tables with broad tenant policies
retain restrictive guards; new private stock tables instead have an exact bounded
Read policy plus maintenance bypass and no broader permissive Read policy.
These checks supplement each module's positive/negative behavioral tests.

The separate native office suite verifies actual cross-office records, source
inheritance, closed history, current revocation and unchanged access relationships.
`test:resource-contracts:browser` uses a real isolated tenant sign-in to inspect
profile and record-limit descriptions, responsive controls and unsaved scope
changes; cancellation leaves stored assignments/rules/profile counts unchanged.
It also checks the directory explanation and makes no business writes.

Verified locally on 2026-10-27: 46 consolidated contract/profile/sharing/audit
checks, 25 native multi-office checks and the 15 focused unit/access checks
(overlapping suites) passed. The real-sign-in Chrome flow passed and confirmed
that unsaved drafts did not change stored policies, assignments or profile counts.
The disposable 129-migration rehearsal and all 18 Inventory native/preservation
checks passed. Production build, TypeScript, changed-file ESLint and whitespace
checks passed. Desktop/mobile screenshots were inspected; the profile table's
entity column was widened to preserve readable descriptions within local scrolling.
No skipped checks were counted as passing. Evidence remains under
`tmp/industry-release` and `test-results/local-access`.

## Workspace UI readiness review

The existing APIs are suitable foundations. UI progress is local only:

1. Phase 2D8A implements the Tenant Admin office-membership editor using the
   existing versioned `/api/access/users/:id/offices` API. Exact offices, company
   grants and explicit subsidiary coverage remain distinct. Read eligibility includes retained
   closed-office history; creation needs an active permitted office.
2. Phase 2D8B connects initial office access to direct creation and invitation
   forms, sharing the membership fields and read-only draft resolver.
   Dated employee workplace placement and leave approval routing remain separate.
3. Phase 2D8C adds the self-service [creation-office selector](WORKSPACE_OFFICE_UI_R10.md)
   through `/api/workspace/offices` and `/api/workspace/office`. It changes only
   a persisted preference, never memberships, Read scope or saved record offices.
   Existing office-specific views keep their own context; this is not a global
   report filter.
   New drafts capture ID/version on opening; stale saves retain the draft and
   return 409. Linked work keeps its source office.
4. Phase 2D8D verifies the combined controls with multi-office managers, explicit subsidiary
   grants, custom profiles, revocation, missing placement and closed history.
   Keep reports/filters based on readable sources, independent of the creation
   preference. Test keyboard/mobile use and changed preferences in another tab.
5. Complete the R10 staged release/recovery gates before exposing these changes
   to hosted tenants. External collaborator accounts remain a later R10 phase.

The combined review is recorded in [phase 2D8D acceptance](OFFICE_ACCEPTANCE_R10.md).
External collaborator identity is the next bounded implementation (phase 3).
Hosted staging/recovery gates remain pending; directory placement never replaces access.
