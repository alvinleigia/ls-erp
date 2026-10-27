# R10 phase 4A: partner introduction evidence

Implemented and verified locally on `staging`. Hosted databases, staging and
production deployments, pilot records and saved hosted sessions are unchanged.
This slice supplies the source-data foundation for phase 4 reporting; it does
not add partner selection controls or change dashboard/report totals yet.

## Separate business dimensions

- **Introducing collaborator** records the external identity that originated an
  enquiry or a direct opportunity. Several named logins can represent that same
  collaborator without becoming separate partners for attribution.
- **Responsible salesperson** remains `assignedUserId`; reassigning work does not
  change its introducing collaborator. Assigning an internal-created enquiry to
  an external login does not infer that the partner introduced it.
- **Supervisor at introduction** is captured with the partner's code and display
  name. Later directory rename, supervisor change, archive or restore cannot
  rewrite that source evidence. Current supervision remains in the directory.
- **Source company/office**, teams, contact/account referrals and lead source
  retain their existing independent identities and authorization rules.

An introducing collaborator is not a new owner, sharing grant, team membership,
office grant or employment relationship. Neither the partner nor its supervisor
receives access merely because their identity appears in source evidence.
This is shared business behavior; Real Estate is not required.

## Creation and conversion contract

New enquiry/direct-opportunity creation accepts optional
`introducedByCollaboratorId`. An active external login automatically records its
own collaborator and cannot claim another one. A Tenant Admin may explicitly
choose an active same-tenant collaborator when creating a source on its behalf.
Other internal users cannot select an arbitrary partner through this parameter.
Their existing internal creation flow remains unchanged.

`partnerAttribution` is a database-captured, read-only snapshot containing
`version: 1`, `code`, `name` and `supervisorUserId`. No private email, phone,
business directory profile, login credentials or access proposal is copied.
Snapshot disclosure follows source-record Read, independently of the admin-only
collaborator directory. New source creation still requires the ordinary action,
source, office, assignment and module permissions.

Converting an enquiry copies its saved introducer and snapshot exactly, including
an unattributed source, regardless of who converts it. Existing unique enquiry
conversion and repeated-conversion behavior remain authoritative. Conversion
after partner archival preserves the original evidence; a new independent source
cannot select that archived partner. General edits cannot rewrite introduction
evidence or detach an opportunity from its original enquiry. Correction of an
erroneously recorded origin requires a separately designed, audited correction
workflow; it is not an unrestricted edit field.

Enquiry import uses the same creation function, including its preview path. It
does not add an arbitrary partner-mapping column. External imports therefore use
the authenticated collaborator; they do not infer attribution from assignee,
email address, text referral or an employee's supervisor.

## Shared implementation and native security

`platform/collaborators/attribution.ts` owns the creation contract and input/error
handling. CRM invokes it within its existing serializable transaction. Normal
creation audits include the captured evidence; audit failure rolls back the source.

Migration 132, `20261027000300_partner_introduction`, adds nullable introducer
relationships and JSON snapshots to the two existing sales roots, with same-tenant
foreign keys and lookup indexes. It introduces no new model, permission resource,
runtime compatibility path, tenant exception or grant.

Native triggers reject rewritten/forged evidence, auto-capture an external
actor's own identity and preserve enquiry conversion even for direct SQL writes.
The source-copy trigger uses invoker visibility, so a private enquiry cannot be
turned into a directory-disclosure lookup. The private directory capture trigger
has a fixed search path and is not a callable search capability. It shares the
tenant security lock with collaborator/account administration and uses locking reads to refresh
authority after waiting, including serializable transactions; existing source RLS and office constraints remain intact.

Existing records stay null in both new fields. Null means **no recorded introducing
partner**, not proof that an employee originated the business. Migration does not
guess or backfill pilot attribution, change owners, timestamps, access, shared
records, financial snapshots, history or existing business outcomes.

## Verification recorded locally

- `npm.cmd run test:partner-introduction`: **52 tests passed**, no skips/failures,
  using disposable Docker PostgreSQL, synthetic accounts and a non-bypass runtime.
  Nine new tests cover independent ownership, administrator selection, self
  attribution across named logins, tenant/archive/forgery denials, direct and
  converted opportunities, ordinary reassignment, rename/supervisor/archive
  history, Restricted-source privacy, immutable SQL evidence, audit rollback and waits behind concurrent administrator
  demotion/partner archival.
- Existing external lifecycle, office/source isolation, quotation/order/financial
  ancestry and resource-ownership checks passed in the same run. All three
  historical office/booking/daily fixture adapters remain disabled in this suite.
- All **132 migrations** rehearsed successfully. Forced rollback and exact
  preservation of all **132 preceding tables**, existing RLS policies and existing
  database functions passed. Existing **18 native stock checks** also passed.
- Prisma validation/generation, production build, TypeScript, changed-source
  ESLint and whitespace checks passed. No UI changes or new visual-verification
  claim in this slice.

Ignored local evidence: `tmp/industry-release/phase4a-verified.log`,
`ls-erp-sales-orders-684d535b60ca.log` and `phase4a-build.log`.
The initial run had one test using asynchronous rejection matching for a
synchronously thrown strict-schema error. The test was corrected and concurrency coverage added; all
52 then passed together. No authorization rule was relaxed.

## Next: phase 4B and release gates

Add admin selection/read-only attribution controls and explicit reporting filters
for introducing partner, internal/external responsible users and supervision.
Company outcomes must be counted once from canonical roots, not once per login,
supervisor, office grant or joined source. Drill-down, count, aggregate and export
must share the same readable population. Attribute linked quotations, orders and
financial results through their canonical opportunity/source; do not maintain a
second editable attribution field on every child. Keep current supervision distinct
from supervisor-at-introduction, and label unattributed records accurately.

Before hosted staging, take and restore-test a fresh encrypted backup, rehearse
all migrations against a copy and compare pilot IDs, owners and effective access.
Production requires a separately authorized release. Nothing is pushed or deployed
by this local phase.
