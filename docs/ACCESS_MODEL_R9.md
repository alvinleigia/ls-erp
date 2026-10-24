# R9: shared teams and record access

Target: staging. Production release requires separate authorization.

The current permission model uses [composable module profiles](ACCESS_PROFILES_R9.md).
Profiles grant actions; sales and project visibility are configured per user.

Every request must pass tenant isolation, current account status, module activation,
resource/action permission, and the resource's record policy. A report filter can
only narrow that result. Team membership is not a permission grant.

Teams belong to the business, independent of CRM activation. A tenant administrator
designates one or more Manager accounts per team. Users can join several teams.
Sales workflow remains a sales setting on the shared team.

Scoped managers can change membership only in teams they manage, with the
relevant team action permission. Existing managers with full authority in both
sales and projects retain tenant-wide team administration. Only tenant admins
can designate team managers. Ordinary membership cannot grant that authority.

## Resource policies

| Resources | Record policy |
| --- | --- |
| Enquiries, opportunities | Own assignments, own plus managed teams, or tenant-wide for Managers; Staff remain own-only |
| Contacts, accounts, activities, quotations, orders, receivables | Inherit accessible sales records, with activity ownership rules retained |
| Projects and property catalog items | Explicit project assignments and project-team membership; separate Manager project scope; subprojects inherit parent access |
| Leave requests | Own requests |
| Leave approvals | Assigned reporting manager; team management never grants approval authority |
| Shift templates, schedules, roster and plans | Existing workforce authority plus action permissions; shared schedules have effects across employees |
| Bookings and purchases | Existing Manager/Admin authority plus action permissions; these currently have no record owner/team |
| Services, inventory, taxes and configuration | Tenant-shared reference data, protected by module and action permissions |
| Dashboards and reports | Inherit each source policy; filters must never widen access |
| Audit reports and user directory | Administrative action permissions and existing account ceiling |

Do not offer a team scope for records without an explicit team/ownership relation.
Adding such a scope requires list, detail, mutation, selector, export and report
adapters, along with cross-tenant and scope-revocation tests.

## Migration 108: shared teams

Rename team tables and the sales-scope column in place; preserve identifiers,
membership, sales workflow, record links and existing scope selections. Translate
stored team permission names. New project scope defaults to existing account
authority, preserving current access until the tenant administrator changes it.
Existing projects have no team assigned. No business records are deleted.

Team membership changes are security audit events. Scoped managers cannot use
the tenant audit report to read hidden sales/project snapshots; they retain
scoped record timelines. Existing tenant-wide managers keep their audit authority.

## Using the changes

1. Open **Users > Teams** to create teams and manage members. A tenant admin can
   designate several Manager accounts in each team; users may join several teams.
2. Open **Settings > Access profiles**. Create reusable profiles, then choose
   **Assign profiles** to combine them for a user and set sales/project scopes
   independently. Actions require the corresponding read/create/edit permission.
3. Assign a **Responsible team** to a top-level project. Team members can read it
   and its active subprojects; explicit staff assignments continue to work.
4. In **Activity overview**, choose **All accessible work**, then a sales team.
   Counts, staff rows, follow-up gaps and activity drill-downs use that selection.
   Activities are attributed to their linked record's team, not every team the
   assigned employee belongs to. Unlinked activities have no team attribution.

## Verification and release status

Implemented locally on the `staging` branch. No hosted database migration,
Git push or hosted deployment has been performed for R9.

- Isolated migration replay through migration 108 preserves all 116 business
  tables after normalizing the reviewed table/column/permission renames. Includes
  all four existing sales scopes, team membership, Manager flags and forced RLS.
- ERP access run with composable profiles: 239 passed, two historical-upgrade-only checks skipped.
  Covers core, CRM, workforce, bookings, inventory, services, projects, catalog,
  dashboards, scope revocation, audits and cross-tenant access.
- Architecture, policy and existing CRM/unit checks also include profile composition.
- Real Chrome tests: 14 passed, including shared teams with CRM disabled, scope
  controls on mobile, team reporting/drill-down and staff project-team access.
- Next build and TypeScript pass. Changed TypeScript/TSX files pass ESLint; a
  stale unused import found during review was removed.

Before a hosted release, verify the staging database identity and take its backup,
apply migrations 108 and 109 and deploy the matching code together. The old
application cannot use the renamed team tables or removed profile-scope columns.
Recheck the isolated QA tenants afterward.
Production release still requires its own fresh recovery/rehearsal checks and
authorization; fixture migration tests do not replace a client-data rehearsal.
