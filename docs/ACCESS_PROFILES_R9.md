# R9: reusable module access profiles

Status: local `staging` implementation; production is unchanged.

## Model

A business user can have several access profiles, for example CRM Manager and
Inventory Viewer. Profiles contain action permissions. The union of active
profiles is checked against module activation, tenant isolation, account authority
and the user's record policy. There is no permission-deny profile: removing a
permission from one profile does not remove it if another active profile grants it.

Record scopes belong to the user, independently of profiles. A profile change can
add an action but cannot change sales/project visibility. This avoids the case
where adding an unrelated Viewer profile widens a Manager's edit scope.
The current scope applies to reads and writes in its domain; per-action visibility
exceptions are not exposed by this implementation.

Staff and Manager account ceilings, reporting-manager leave approval and module
dependencies still apply. A profile alone does not confer team-manager designation
or approval relationships. Tenant admins retain full tenant authority. Customer
accounts retain their separate personal-access rules.

No assigned profiles means no business permissions for Staff/Manager accounts.
New users start with Own / assigned sales and project scopes. Each profile must
grant Read before its other actions on a resource. Disabled/archived profiles
contribute no permissions; changing or removing profiles affects the next request.

## Configuration

1. Open **Settings > Access profiles > New profile**.
2. Choose a module and copy its Viewer or Manager template. Review the action
   checkboxes, name the profile and save. Templates include dashboard access.
3. Choose **Assign profiles**, select a user and add one or several profiles.
4. Set that user's sales and project scopes separately, then save.
5. User creation offers the same multi-profile selection and visibility controls.

Several-modules profiles remain available for a deliberate combined role.
Shared references and cross-module workflows can require additional profiles:
for example, shared team configuration uses core permissions, and creating an
order from a quotation also requires access to the source document.

An archived assigned profile must be replaced before it can be selected again.
Normal profile archival requires reassigning its users first. Assignment edits
carry a policy version; stale and concurrent changes cannot overwrite newer
profile sets or visibility. Assignment, visibility and audit writes are atomic.

## Migration 109

- Preserve existing role/profile IDs, permissions, names, versions and membership.
- Change the assignment key to tenant + user + profile, permitting multiple grants.
- Copy each user's former role scopes into its own `TenantUserAccess` policy.
- Existing unassigned Staff/Managers receive an ordinary explicit account-access
  profile containing the permissions known at migration time. Account ceilings
  and existing scope behavior remain in force. Future modules are absent from
  that frozen grant and require explicit permission updates.
- Remove scope columns from profiles. No old-payload runtime translation or
  implicit allow-all fallback is introduced.
- Force RLS on user policies, preserve runtime grants, and enforce tenant-bound
  user/profile foreign keys. No client business records are deleted or rewritten.

## Requirements for every module

1. Register permission resources/actions in `platform/access/catalog.ts` and
   classify their record policies in `platform/access/resource-policy.ts`.
2. Use the shared authenticated business entrypoint and fresh `accessContext`.
   Never manufacture an actor with unchecked permissions from a session role.
3. Check module activation and required actions on the server. Apply the native
   record predicate to lists, detail, writes, selectors, reports and exports.
4. Test missing grants, composed grants, revocation, tenant boundaries and native
   approval/record rules. Protect private source records in linked workflows.

Module choices and Viewer/Manager templates derive from the resource registry;
new modules inherit the same composition and assignment mechanism. Features with
no independent permission resource, such as nested Payment Plans, use their
parent module's permissions rather than an empty standalone profile.

## Verification

Verification uses disposable local databases and real Chrome sessions. Existing
workflow fixtures now grant explicit profiles; new-profile security tests create
plain unassigned accounts to exercise the deny-by-default behavior.

Verified runs:

- ERP access and profile integration: 239 passed, two historical-only checks skipped.
- Orders, reservations, receivables, catalog and quotations: 59 passed.
- Sales teams and enquiry import: 30 passed.
- Shared CRM/architecture/policy unit run: 60 passed; focused profile checks: 10 passed.
- Real Chrome: 14 passed, including profile creation, multiple initial profiles,
  assignment editing, read-only inventory and live scope preservation.
- Migration replay through 109 preserves all 116 prior business tables and seven
  seeded existing-account grant/scope combinations; the new policy table has forced RLS.
- Next build, TypeScript and changed-source ESLint pass. Desktop and mobile profile
  screenshots were inspected.

Hosted deployment is pending. Apply migrations 108 and 109 with the matching
application version after backup/rehearsal checks. Older application builds cannot
use the renamed tables or removed single-role scope columns.
