# P13S - delegated partner workflow

Local implementation, 2026-11-10. Hosted staging and production remain unchanged.
This is the first workstream in P13S_IMPLEMENTATION_PLAN.md; KYC is still pending.

## Behaviour

An explicitly authorised internal operator can select an existing active partner
on a new enquiry or direct opportunity, add attribution after saving, or replace
and remove it. Saved changes require a reason and current source version. The
Partner / CP tab shows the current accepted name/code and the most recent 50
history entries; the database retains every event.

Changing the partner does not change the salesperson, office membership, sharing,
login rights or commission. Directory management remains administrator-only.
External logins self-attribute and cannot act as another introducing partner.
Conversion preserves the source enquiry; later corrections are explicit on each
source. Confirmed orders, accepted quotation revisions and issued PDFs retain
their saved facts. Reports read the canonical current fields without double count.

## Access configuration after release

Use ordinary profile and user record-limit administration. No named-user checks
or Ewissen-specific paths are introduced.

For central Booking & Collections operators, add only:

- partnerChoices.read: All accessible records, for the bounded active directory.
- partnerLinks.read/create/edit: All accessible records; parent Read/Edit and
  office/Restricted-record rules still bound the source being changed.

Retain all existing grants and scopes. Create permits initial/later linking;
Edit permits replacement/removal. Omit Edit for operators who should only add a
missing partner. Existing enquiry/opportunity Create/Edit permissions are still
required independently. Profile permission changes alone do not replace explicit
record limits. No live profile has been changed during implementation.

## Data and release

Migration 20261110000100_delegated_partner_links adds the typed append-only
CrmPartnerLinkEvent table and deliberately replaces the introduction guards.
The existing tenant-bound introducer fields remain the canonical single-primary
link. New helpers expose only eligible ID/name/code/type choices; the full private
collaborator directory stays under its existing RLS. SQL guards enforce selection,
source lineage, reason/version and evidence capture even for native writes.

Saved corrections take the tenant security lock before the operational mutex,
then resolve current grants. Simultaneous corrections cannot upgrade shared
locks into a cycle: one succeeds and the stale source version is rejected.

No permission, attribution or customer backfill occurs. Existing recorded CP
values are preserved, including their captured names/supervisors. The rehearsal
seeds pre-cutover CP selections/conversion before hashing the existing tables,
tests forced rollback, and verifies exact row preservation after application.

Before hosted rollout, perform the planned read-only tenant preflight and
controlled recovery/migration release. Apply the matching migration before
deploying queries for the new table; normal staging migration guards remain in
place. Configure the additional profile grants/limits only after that release.

## Verification

- 62 partner, external-login, office and resource-ownership integration checks.
- 33 sales/financial/activity/dashboard partner checks, including correction
  reclassification and exact preservation of confirmed agreements, saved
  quotation revisions, receivables, receipts and document rows.
- 14 access-policy/profile/resource-action unit checks.
- Four browser workflows: delegated create/add/change/remove, administrator
  creation/conversion, external self-attribution, and partner report filters /
  drilldown / export. Desktop/mobile screenshots inspected.
- Historical migration rehearsal preserves 166 existing tables and verifies
  rollback with populated CP facts. Build, TypeScript, targeted lint and Git
  whitespace checks passed. The combined focused run passed all 109 checks;
  the final build passed all four browser workflows.

All business writes use disposable local PostgreSQL and synthetic browser users.
No Ewissen sales, documents, payments, KYC evidence or template publications were
created as test data.

Use `npm.cmd run test:partner-introduction` for migration/access checks, adding
`-- --browser` after a current build for the native browser workflows. Its
test-only DNS helper makes *.localhost resolve consistently in Chrome and
Playwright API requests on Windows; it does not run in the application.
