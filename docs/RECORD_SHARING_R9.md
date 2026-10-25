# R9: selected record sharing and restricted visibility

Current target: hosted `staging`. Migrations 108–111 and matching application code
were deployed and tested there on 2026-10-25. Production remains unchanged. See
[the hosted verification report](STAGING_ACCESS_VERIFICATION_R9.md). Local milestone
evidence below records the implementation checks preceding that hosted release.

## Using sharing

A tenant administrator opens a supported record and selects **Sharing**. Choose
**Normal access** to keep existing visibility and add selected people or teams.
Choose **Restricted access** to allow responsible staff, selected recipients and
tenant administrators. An ordinary manager's All tenant records scope does not
bypass Restricted access. Administrators retain oversight and manage sharing;
ordinary Edit permission does not confer security administration.

Add users or teams with **Read only** or **Read and edit**. User and active team
grants combine: an Edit team grant still applies if the user also has a Read
grant. Removing a grant does not remove access obtained through another grant,
responsibility or Normal scope. To exclude ordinary tenant-wide users, use
Restricted visibility and explicitly select those who should retain access.
There is no user/team deny list with conflicting precedence rules.

The recipient still needs an active account, module activation and the relevant
profile action. A None record rule always denies. Read bounds every action.
Read and edit makes the record eligible for the recipient's independently granted
actions; it does not grant Assign, Archive, payment collection or confirmation.
Converting an enquiry requires enquiry Edit access as well as opportunity Create.
Restrictions on linked source records also apply. Share the necessary source
context explicitly when it is restricted. Changes take effect on the next
authorized request; information already viewed cannot be recalled from a browser.

## Supported adapters

| Records | Responsibility and inheritance |
| --- | --- |
| Contacts and accounts | Record owner |
| Enquiries and opportunities | Assigned user; private source contacts/accounts/projects and source enquiries remain bounds |
| Activities | Assigned user; private sales/customer/collection context remains a bound |
| Projects | Explicit responsible project members; parent sharing governs subprojects; native action and active-only rules still apply |
| Quotations | Responsible opportunity assignee; source opportunity privacy still applies |
| Sales orders | Responsible opportunity assignee; source quotation privacy still applies |
| Receivables, payments and reservations | Follow the sales order's sharing; each action retains its own permission and native transition checks |

Bookings, workforce schedules, purchasing and reference configuration retain
their registered profile/rule adapters. This release does not add per-record
sharing to those resources. Future modules register their native owner/source
relationships and use the common sharing service, predicates and action metadata.
Do not offer privacy before conflict, availability, reporting and linked-record
paths can enforce it. Teams remain flat; managers can oversee several teams.
Nested team trees are deferred until a real organizational need is established.

## Implementation contract

- `sharing-registry.ts` defines the native record types and canonical aliases.
- `sharing-scope.ts` combines normal eligibility with explicit selected grants.
  Source predicates, permission checks and None rules remain mandatory.
- `sharing-service.ts` validates fresh tenant-admin authority and active local
  recipients, locks the native record, checks the version and audits changes in
  the same transaction. Concurrent/stale saves cannot partially replace grants.
- `record-actions.ts` combines exact action probes with sharing; the shared detail
  header renders the editor. Lists, details, writes, selectors, reports, exports
  and SQL paths must use their normal native adapters as well as privacy bounds.
- `database-actor.ts` and the tenant PostgreSQL adapter bind authenticated identity
  transaction-locally. HTTP business handlers establish request identity, and
  `authorizeBusinessOperation` binds it after rechecking current authorization.
  No persistent pooled-session identity or per-tenant pool is introduced.
- Migration 111 adds restrictive RLS policies for records, linked tables, revisions,
  timelines and audit copies. Private parent restrictions cannot be bypassed by
  sharing a child. Append-only audit/timeline writes do not require Read access
  to the resulting history after an authorized owner handoff.
- Audit, owner changes and sharing changes are atomic. Existing business records,
  IDs, ownership, profiles, rules and memberships are preserved. No existing
  record is automatically shared or made Restricted.

Unique-item availability remains authoritative even when the reserving order is
private. `CatalogReservationAvailability` exposes only tenant/item, status and
expiry. Its trigger-maintained rows contain no order, customer or reservation
identity; ordinary users cannot write them. Catalog filtering uses this projection
before pagination/counting. A narrowly scoped database function reclaims only
database-clock-expired holds under the item lock, with event and audit records in
the same transaction. It returns no private record data.

The SQL privacy/expiry helpers run in the unexposed `app` schema with a fixed
search path. They require a migration owner with PostgreSQL superuser/BYPASSRLS
authority; migration preflight fails otherwise. Existing authorized system RLS
bypass remains the maintenance mechanism. Never grant runtime BYPASSRLS or expose
these helpers as public RPCs.

## Migration and release boundary

Migrations 108–111 must be released with matching code. They are applied on staging;
production still requires its separate release. Migration
111 is transactional and fails closed on unsupported migration-owner authority.
The local rehearsal injects failure before commit and verifies complete rollback;
successful replay compares all 117 prior business tables, excluding the new null
sharing pointer, and checks forced RLS plus empty sharing policies/grants. The
availability projection is backfilled from existing active reservation states.

These are synthetic local checks. A hosted staging release still requires the
correct project/database, a fresh verified backup, migration privilege checks,
matching deployment and tenant-specific visibility comparison. Production and
client records remain unchanged by local implementation and testing.

## Verification

Commands use disposable local PostgreSQL with runtime forced RLS and synthetic
users. Browser tests sign in using separate ephemeral local Chrome contexts;
they do not use client credentials or hosted saved sessions.

- `node scripts/test-sales-orders.cjs --sharing`: read/edit sharing, user/team
  union, membership revocation, admin boundary, None/profile caps, private source
  restrictions, tenant isolation, stale save/audit rollback, SQL/export/audit
  privacy, financial children, handoff, project inheritance and availability.
- `node scripts/test-sales-orders.cjs --sharing --browser-only`: desktop/mobile
  editor, administrator/manager/read-only recipient views and grant revocation.
- Existing `--access`, `--crm`, `--teams` and default financial suites replay the
  new migration and exercise unchanged module behavior.

Verified locally on 2026-10-25 (groups overlap; do not add their totals):

| Check | Result |
| --- | --- |
| Selected sharing and privacy | 13 passed |
| ERP resource/action access | 258 passed; 2 historical-only checks skipped |
| CRM, configuration, users, branding and audit | 136 passed; 2 historical-only checks skipped |
| Orders, quotations, receivables, reservations and catalog | 61 passed |
| Teams and enquiry import | 30 passed |
| Existing CRM unit suite | 60 passed |
| Action-policy/reference and notification unit suite | 10 passed |
| Combined local real-Chrome access and sharing suite | 15 passed |
| Production build, TypeScript and changed TS/TSX ESLint | Passed |

The Chrome run covers delegated profiles, record action limits, team selection,
source privacy, revocation, and the new sharing editor. Desktop/mobile sharing,
read-only recipient, mobile profile assignment, project-team and activity overview
screenshots were inspected. Evidence is local under `tmp/r9-access` and
`test-results/local-access`; it is not hosted-stage verification.

A loaded parallel run exceeded an existing five-second workforce transaction
limit. The quieter full access rerun passed; no runtime timeout was changed.
