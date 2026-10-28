# R10 hosted sharing and browser editing - phase 6D6

Verified on 2026-10-28 with fresh synthetic fixture `QA6S MVRQ8OJ2` on the
existing staging QA tenant aliases. All hosted writes used ordinary application
APIs or browser forms on these exact fixture records. No client account,
application code, schema, environment value or deployment changed. Nothing was
pushed and no production write was made.

Completed receipts contain **188 hosted checks**: 50 enquiry/browser checks,
104 sharing/source checks and 34 project/financial browser checks. Counts include
successful HTTP and behavioral assertions across resumed segments, including
repeated reads; they are not 188 distinct end-to-end scenarios. Setup has a
separate 35-check receipt. Cleanup passed 75 checks, followed by 89 independent
read-only audit checks.

## Enquiry sharing and actual browser writes

A tenant administrator used the desktop and mobile Sharing panel to restrict an
enquiry and select two users with Read only access. An unrelated manager with
All record limits could not read it. A recipient could read the enquiry but had
no editing or sharing-administration controls.

Adding a selected-team Read and edit grant combined with the first user's direct
Read grant. That user saved a real enquiry-title edit through mobile Chrome;
the response returned 200 and a fresh API read verified the saved title, original
responsible user and source office. The other team member remained read-only
because their profile had no Edit action.

Removing the team Edit grant immediately returned the first recipient to Read
only. Removing the remaining user grant then denied both API access and the
reloaded browser detail. The second recipient retained their independent Read
grant. These transitions used the same recipient login session.

## Sharing remains bounded by the common access model

- Selected Edit cannot grant a missing action, bypass a None rule or authorize
  sharing administration. An attempted responsibility change without Assign is
  denied. The enquiry's Create metadata remains false; project Archive is
  independently denied without that registered action.
- A team Edit grant combines with a user Read grant. Archiving that team removes
  the team-derived editing eligibility; restoring it restores eligibility.
  Clearing the recipient's profile removes record access despite sharing.
- Stale policy versions, duplicate recipients and foreign-tenant recipients are
  rejected without partially changing the policy or grants.
- Responsible-user access survives Restricted visibility with no selected grants.
  Handing responsibility back removes that access. Normal visibility preserves
  ordinary All access; Restricted visibility removes it.
- Restricting the source contact hides the otherwise shared enquiry, including
  its CSV export row. Sharing the required contact restores access. Export checks
  use the ordinary export route and record/source predicates.

## Projects and linked financial records

The administrator opened Sharing from a child project. The panel explicitly
identified parent inheritance; saving changed the parent's policy, and the child
reported that same record ID and version. A selected team could read both while
the unrelated All-scope manager remained denied.

After upgrading the inherited team grant to Edit, the recipient saved a real
mobile description edit on the child project. A fresh read verified the exact
description and unchanged parent. An Archive attempt returned 403. The profile
without project Edit still had no editing controls despite the team grant.

Restricted contact, opportunity and quotation sources continued to bound the
shared quotation, sales order and receivables. Sharing a child did not bypass a
private ancestor. Removing the quotation grant hid the order and receivables;
restoring it restored authorized reads. With the explicit quotation Export
permission present, the private-source PDF request returned 404 before generation.
No PDF was issued or stored during this fixture.

Chrome showed the authorized quotation version and confirmed order as read-only:
no editing/sharing controls on the quotation, and no Confirm/Cancel controls on
the order. The receivables API reported `canRecord: false`; order cancellation
by the read-only user was denied. No payment was recorded. Financial transitions
and payment/correction behavior retain the separate phase 6D2 evidence.

Eight captures were visually inspected: desktop/mobile enquiry Sharing, mobile
enquiry editing, the read-only enquiry, inherited project Sharing, mobile project
editing, and read-only quotation/order pages. Stable panel bounds and body overflow
were checked for the relevant captures. Completed resumed browser checks recorded
no page errors. This does not certify every form or an exhaustive browser matrix.

## Runner corrections and retained evidence

The first runner looked for Save enquiry instead of the actual Save changes
control, and an unobserved response-wait rejection interrupted its receipt. Its
uncertified check count is excluded. The enquiry had not been edited; a fresh
read confirmed this before resetting only that test record's sharing configuration
and resuming. No business entity was recreated.

Further runner corrections used the registered action catalog (enquiries have no
Archive action), skipped sheet-bound checks on pages without an open sheet, and
included the quotation version suffix in the heading locator. A None-bound read
correctly returned 403. The PDF recipient first lacked Export; the new fixture
profile was explicitly granted Export before testing the source-private 404.
These were test/setup corrections, not application permission changes.

Finite panel animations are finished before capture; an intermediate sliding
frame is not treated as a layout defect. Completed segment receipts and failed
attempt evidence are retained privately rather than reporting failed exits as
completed acceptance.

## Cleanup and release boundary

The independent audit verified six archived accounts, cleared explicit office and
profile assignments, two archived projects, an archived team, contact, pipeline,
lost reason, office and company. Six canonical sharing policies remain Restricted
with zero selected grants; the child still inherits the grant-free parent policy.
Retired writer and recipient credentials cannot sign in.

The enquiry is closed with its saved mobile edit and original responsible user
and office. The opportunity is Lost in its original office. The order is canceled
with its quotation/revision/200 INR consideration and cancellation history intact;
outstanding balance and payment count are zero. One quotation version remains,
with no issued PDF. Historical records were not deleted to conceal test activity.

The final read-only staging database check verified project
`oyhsrcmjhwxhvepdbcdc`, 132 applied migration checksums, no pending or rolled-back
attempts, and the expected non-superuser/non-bypass runtime role. The pinned
source manifest passed. Vercel metadata still returned HTTP 403, so deployment
and alias identities were not freshly certified.

Private receipts, utilities, fixture IDs and captures live under
`tmp/industry-release/phase6d6/MVRQ8OJ2`, with hashed copies in the existing private
staging checkpoint. Credentials, environment files and session state are excluded.
This is not a new database backup or standalone recovery tool.

Next: consolidate release readiness across phases 6C-6D6. Release still needs
renewed Vercel authentication, current target/candidate verification, fresh pilot
recovery checks and a separately authorized production cutover. This staging
checkpoint does not approve production release.
