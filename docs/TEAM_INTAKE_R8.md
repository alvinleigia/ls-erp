# R8 flexible sales team intake

New teams default to **Enquiries and direct opportunities**. The same team
can receive unqualified enquiries, convert an accessible open enquiry without a
mandatory Qualified status, and create a ready opportunity directly. Existing
contact, assignment, module, action and record-scope checks still apply.

The Sales workflow field offers three choices:

| Choice | New enquiries and imports | Direct opportunities | Conversion |
| --- | --- | --- | --- |
| Enquiries and direct opportunities | Allowed | Allowed | Qualification optional |
| Qualify enquiries first | Allowed | Blocked | Qualified enquiry required |
| Direct opportunities only | Blocked | Allowed | Existing open enquiries can still convert |

Conversion retains the enquiry's team, contact, shared custom fields and existing
attribution. A closed enquiry must be reopened first. Repeated conversion reuses
the existing opportunity. Membership alone does not grant access to a colleague's
record, and each record still has one assigned salesperson.

## Existing teams and migration

Migration `20261024000100_flexible_team_intake` extends the existing checked
workflow values with `BOTH` and changes the database default for new teams.
There is no backfill or rewrite of teams, memberships, roles, sales records,
financial records or module activation. Existing `ENQUIRY_FIRST` and `DIRECT`
rules remain valid choices. A team edit that omits workflow preserves its value.

To let an existing Field team use both paths, an authorized administrator or
manager opens CRM Configuration, Sales teams, the team, Edit team details, then
chooses Enquiries and direct opportunities and saves. This is an explicit,
versioned and audited configuration change.

Enquiry import choices include active `BOTH` and `ENQUIRY_FIRST` teams. Import
preview and row creation use current team rules; switching a team to Direct after
preview cannot import stale ready rows or leave an orphan contact behind.

## Verification and rollout

Use `npm.cmd run test:crm:team-intake` for isolated upgrade, CRM team and enquiry
import integration checks. Run the same command with `-- --browser` after a current
build to include local UI workflows and terminology configuration. All fixtures
are synthetic and the runner rejects hosted database destinations.

On 24 October 2026, 30 isolated team/import integration tests and six real local
browser checks passed, including terminology overrides and desktop/mobile forms.
The complete application build and targeted lint passed. Both migration rehearsal
and the staging migration advanced history from 106 to 107 and preserved all 116
existing business tables. Runtime RLS was verified with the restricted account.
Staging application `defb9ad` was deployed to the main staging and both QA aliases
and passed the hosted team intake workflow in 45.4 seconds. It exercised the UI
default, both creation paths, optional conversion qualification, required
qualification, direct-only rejection, retention of existing records and foreign
tenant denial. Desktop/mobile screenshots were inspected without overflow or
browser errors. Restricted runtime queries saw no team or audit records without
tenant context or from the other tenant; the owning tenant saw the team and all
five matching team configuration audits.

The synthetic team `QA R8 Flexible team 8b83d6c3` remains in QA Staging A with
workflow BOTH so it can be reviewed. Existing user-created teams were not changed.
Production release is separate from this staging increment. The earlier Word/PDF
client guide describes the previous two-option model; use this page for the new
team intake controls until that guide receives its next edition.
