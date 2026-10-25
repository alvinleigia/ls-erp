# R9: shared teams and record access

Current contract: [resource/action standardization](ACCESS_STANDARDIZATION_R9.md).
Profiles grant actions; each user's record rules bound where those actions apply.
Tenant isolation, activation and native business rules apply to every operation.
A report filter can only narrow accessible records.

Supported native records also use [selected sharing and Restricted visibility](RECORD_SHARING_R9.md).
Explicit sharing can extend Own eligibility within granted actions; None still
denies. Restricted visibility excludes ordinary tenant-wide managers unless
responsible or selected. This is separate from the report/team filter.

## Teams and hierarchy

Teams belong to the business under **Users > Teams**, independently of CRM.
Users can belong to several teams. A tenant administrator can designate several
team managers, including Staff or Manager accounts with appropriate profiles.
Designation is distinct from profile permissions; both are needed to manage
team-scoped work. Only tenant administrators change manager designation.

Ordinary membership does not grant team-wide CRM visibility. A user's Own and
managed teams rule includes their own assignments and records belonging to teams
they currently manage. All tenant records deliberately grants tenant-wide scope.
Removing a designation takes effect on the next authorized request.

CRM workflow configuration remains attached to the team. Project responsible-team
assignment and direct staff membership are separate from sales ownership. An
Assigned active records project rule includes explicit members and members of
the project's team; subprojects inherit parent access. Other project rules can
limit editing, assignment and membership administration independently.

## Resource adapters

| Resource family | Supported bounds |
| --- | --- |
| Enquiries, opportunities, quotations, orders, receivables, payments, reservations | Own assignments, own and managed teams, all, none; document ownership follows its sales source |
| Contacts, accounts, activities | The above, plus owned/assigned sales context where supported |
| Projects and project membership | Direct assignments, assigned active records, own/managed teams, all, none |
| Leave requests | Own requests; personal eligibility still applies |
| Leave approvals | Configured reporting staff or all eligible reporting routes; never team-based or self-approval |
| Bookings, purchases, shifts, catalogs and reference configuration | Tenant-shared All/None until a real ownership adapter is implemented |
| Dashboards, reports, selectors and exports | Source predicates and the relevant action; filters never expand access |
| Audit logs | Business events or broader eligible events, still limited by source permissions; security history remains administrative |

Team membership inspection, project membership inspection, restricted custom
fields, branding and assignment targets have explicit permissions. A general
record Read grant does not silently confer these capabilities.

Employment configuration defines leave routing: reporting-manager review or
tenant-admin review. A designated reviewer needs current approval permission and
the corresponding record rule. Sales-team management never changes this route.

## Reporting

In Activity overview, choose **All accessible work**, then optionally a team and
employee. Administrators can select any accessible team; a scoped manager sees
teams permitted by current policy. Metrics and drill-downs reuse that selection.
Activities follow their linked sales record's team; unlinked work has no team
attribution. They are not attributed to every team their assignee belongs to.

## Migration

Migrations 108–110 preserve IDs, team/project memberships and record owners.
Migration 110 translates prior account ceilings and visibility into ordinary
per-action rules, then drops the old two-scope columns. Frozen historical test
fixtures are not imported by runtime code. Migrations 108–111 are applied on
hosted staging; its backup, visibility comparison and code/schema cutover passed.
See [hosted verification](STAGING_ACCESS_VERIFICATION_R9.md). Production requires
its separate verified backup, visibility comparison and matching release.
