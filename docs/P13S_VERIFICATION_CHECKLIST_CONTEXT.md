# P13S verification checklist context

Normal person and business-account verification defaults to Customer. Collectors
do not choose between customer, additional customer and representative when the
required fields/documents are identical. The editor groups identical requirements
for the current subject type and shows Verification checklist only when there are
different configured collections of required fields or documents. Roles without
collection requirements do not add routine dropdown options.

Opportunity and sales-order Participant verification cards provide Open verification
for users who can read private submissions and the appropriate contact/account
directory. The link opens that existing contact/account's Verification tab with
the saved participant role selected automatically. Orders use their frozen
participants, while opportunities use their current selections. The contextual
editor displays the role as text and offers no role dropdown.

The URL role is an editor context, never an authority or assignment grant. All
source visibility, private submission/evidence access and native write/checkpoint
guards remain in force. The contact/account endpoint independently rechecks access;
a link cannot grant access to a record. Selecting a checklist never changes the
person's booking role or creates another contact.

An explicit role filter now selects that role's latest submission, current review
and status in collection/submission views. Immutable case revision numbers remain
global: the API also returns caseVersion so correction and review writes use the
latest case token, even when viewing an older revision that is current for its role.
The paginated history and central queue retain every role's original submissions.
Unfiltered API reads retain their existing latest-case semantics.

Approvals remain role/policy-specific. Identical checklists simplify collection
choices; they do not silently approve another role. Staff complete the applicable
participant role through the transaction link rather than preparing all three
roles for every customer. No existing approval, evidence, customer correspondence,
participant assignment, checkpoint configuration or policy is rewritten.

This is shared across industries, people/business accounts, opportunities and
orders. It adds no schema migration, dependency or storage copy.

Validation commands:

```powershell
npm.cmd run build
node scripts/test-sales-orders.cjs --verification-crop --browser
```

Regression coverage includes common/distinct/subject-specific checklists, role
query validation, scoped statuses with no private-read bypass, independent role
approvals, global stale-write tokens, default contact collection, automatic order
participant navigation, preservation of drafts across subtabs and status-only
operators receiving no private verification link. Existing upload, crop, disposal,
retention, independent-review and Required booking-checkpoint checks run alongside.

Verified on 2026-11-17: production build, TypeScript, targeted ESLint and whitespace
checks passed. Twelve focused unit checks and 68 native/integration checks passed.
All 17 local browser flows passed in the final run, including Required order
confirmation/allocation, the automatic participant link, common/distinct checklists,
role-specific corrections and the existing file/review regressions. The first run
caught a tab-link key error and a refresh/edit race; the link now uses the shared
navigation helper, and submission actions wait while their latest state loads.
Subtab draft preservation remains verified. Local receipts are under
`tmp/p13s-checklist-context/` and
`tmp/industry-release/ls-erp-sales-orders-ae3ccc3f7f8a.log`.

Source `c89cc13531305d9e3a4f4a867c3db57125fc8571` is READY on staging deployment
`dpl_9UZqEMgjCkN38FZtruaj7Gi8NvEe`. Both hosted acceptance tests passed, including
the added common-checklist/context check: Customer approval stays valid while an
Additional customer submission is pending, and its contextual editor displays the
correct revision without a role dropdown. Desktop/mobile captures were inspected.
Staging tests used owned synthetic tenants, normal APIs and real private storage.
No hosted seed/reset was used. Production still points to
`dpl_4dLeTyXmvWEQfeR1LpNqc1ogAEeF`; no production configuration or record changed.
This increment is committed locally and staged, without a Git push or production
release. Hosted receipts are in `tmp/p13s-checklist-context/staging.log` and
`test-results/staging-access/`.

## Production release

Released on 2026-11-17. The staging-only statement above records the earlier
acceptance milestone. GitHub main/staging were fast-forwarded atomically to
`b8c9d29d74ca54903757aa3cbcbc4183aa1b4b13`. Application/test code matches the
tested staging source exactly; the subsequent commit recorded acceptance only.
Production `dpl_HvDtcaKAwg2nQ9MbCNvRtQqseT7p` and staging
`dpl_B5sLXREwvuDTLQMUFg6giwXRj5NF` are READY at that source. Their registered
production and staging alias mappings were verified.

Both databases retain 159 applied migrations with none pending. No maintenance,
schema migration, storage change or permission update was needed. A read-only
pre/post comparison of seven Ewissen configuration tables matched exactly: modules,
access profiles, role assignments, record scopes and verification policy/checkpoint/
retention versions. No production customer documents or business records were
changed. The previous production deployment remains a code rollback target.

Public sign-in availability passed for erp.ewissen.in and leiwissen.leigia.com;
the anonymous auth-session endpoint exposes no authenticated user. The Vercel
fallback alias has a deployment mapping but its auth page returns 404 because
tenant-host routing requires a registered business/root host; routing code is
unchanged in this release.

Authenticated production UI smoke is pending: saved tenant sessions are no longer
authenticated. Dedicated Chrome was opened at the Ewissen sign-in page and the
user was asked to sign in; deployment was completed independently. After login
confirmation, run browser:save and the read-only helper
`tmp/p13s-checklist-context/smoke-production.cjs after`. It blocks mutating browser
requests and checks default/checklist/context views without uploading or submitting.
The 17 local and both hosted staging flows remain the completed functional evidence;
do not describe the private production UI as verified until that smoke passes.

Private release receipts are under `tmp/p13s-checklist-context/production/`.
This release-record follow-up is local and does not trigger another deployment.
