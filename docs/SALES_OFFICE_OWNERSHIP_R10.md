# R10 phase 2B: native office ownership for sales records

This is a local milestone on `staging`, not the office-isolation release.
Operations/workforce ownership, workspace controls, assignment
selectors and hosted verification remain prerequisites. External collaborators
follow in phase 3. No hosted database or deployment was changed for this work.

## Ownership contract

Migration 114, `20261026000300_sales_office_ownership`, persists immutable
`officeId` on enquiries, opportunities, activities, projects, enquiry import
batches and activity-plan launches. Composite tenant/office foreign keys and
restrictive RLS protect native data. Existing profiles, owner/team rules, sharing
and activation remain mandatory. Office membership grants no action; broad
manager permissions and explicit sharing cannot bypass an office boundary.
Tenant Admin retains tenant oversight.

Independent records use the user's explicit creation-office preference. Forms
capture its ID/version when opened and send `x-office-id`/`x-office-version`.
A stale form returns 409 without saving or silently adopting a newer preference.
Missing HTTP context returns 403 for independent records. Internal service calls
capture the explicitly persisted preference once per transaction. Missing
membership/preference never falls back to an initial office. Pool scope is
cleared at each transaction boundary.

Linked work inherits its canonical source office independently of that
preference: conversion, activities, follow-ups, collection work, subprojects,
imported enquiries and plan steps. Office identity cannot be changed by editing
a source. Project add-on references must use the same office. Assignees and
project members require eligibility for the record's office.

Quotations inherit their opportunity's office. Revisions, orders, receivables,
receipts, allocations, reversals and reservations follow the same source chain
without duplicated office fields or rewritten snapshots. A quotation's source
is immutable. Project units inherit the project's office; a cross-office unit
cannot be copied into a new quotation snapshot. Availability is scoped to the
visible catalog item; clock-only expiry does not expose a private order.

Contacts and business accounts deliberately remain tenant-shared master parties
under their existing action, owner/related and Restricted controls. One customer
can be referenced by several offices. General catalog items and configuration
remain shared reference data; this grants no access to linked operational data.

RLS covers roots, source children, typed values, import rows, sharing metadata
and audit/history copies. Typed-value policies use an uncorrelated visible-parent
subquery to avoid resolving company membership again for every field value.
The migration's closed source registry defines native ownership and child
policies. Future resources need a source entry, write invariant, child policies
and positive/negative isolation tests before exposure.

## Migration and verification

Existing records enter their tenant's initial office. Only the six office fields
and nullable enquiry import provenance are added. IDs, timestamps, responsible
users, teams, profiles, grants, typed values and frozen document content remain
unchanged. Rehearsal compares all 125 preceding tables, forces a rollback,
checks that the timestamp-changing activity trigger is restored, and then
verifies a successful migration. There is no runtime compatibility flag,
role fallback or tenant-specific override.

Use guarded disposable local PostgreSQL only:

```powershell
npm.cmd run test:office-records
npm.cmd run build
npm.cmd run test:office-records:browser
```

The dedicated suite has no implicit fixture memberships. It tests two offices,
foreign references, managers, missing profiles, direct SQL, sharing, assignment
rollback, immutable ownership, stale/missing context, source inheritance, typed
filters, financial children, units, imports, revocation, closed-office history
and pool reuse. Chrome signs into a synthetic tenant and submits the real form
before and after an office change.

Frozen R9 factories explicitly supply single-office metadata through privileged,
local-only fixture triggers. Runtime-role operations receive no fallback. Those
triggers are absent from the dedicated suite and migration 114.

Verified locally on 2026-10-25:

| Check | Result |
| --- | --- |
| Office-record isolation | 25 passed |
| Authenticated Chrome form/session flow | Passed; completed detail screenshot inspected |
| Office membership/context | 22 passed |
| Existing ERP access | 258 passed, two historical-only skips |
| CRM, fields, audit, settings, users and branding | 136 passed, two historical-only skips |
| Sales, quotations, catalog, reservations and receivables | 61 passed |
| Sales teams and enquiry import | 30 passed |
| Selected sharing and Restricted privacy | 13 passed |
| Migration rollback and preservation | All 125 preceding tables retained |
| Build, TypeScript and changed-file lint | Passed; one pre-existing unused fixture warning |

The 10,000-value custom-field filter returned five rows from ten matches in
15 bounded queries, approximately 1.54 seconds for the service in the recorded
run. No transaction limit was raised. An ERP scheduling test timed out while
competing with the build; the complete ERP suite then passed without that build
workload. Evidence is retained in ignored `tmp/industry-release` logs.

## Remaining release work

1. Complete workforce, scheduling, bookings, purchasing and other operational
   ownership, including personal access and privacy-safe conflict checks.
2. Expose office membership and creation controls and constrain assignment/reference
   selectors. [Invitation onboarding](INVITATION_ONBOARDING_R10.md) and the
   [direct user/tenant provisioning backend](OFFICE_PROVISIONING_R10.md) are implemented.
   Newly created unassigned users have no office access by design.
3. Complete reporting and security-path review, rehearse against a backup copy,
   compare pilot visibility, then deploy and verify on hosted staging.

Do not deploy migrations 112–114 as a finished organization-scope release until
these items are complete. Production remains a separately authorized release.
