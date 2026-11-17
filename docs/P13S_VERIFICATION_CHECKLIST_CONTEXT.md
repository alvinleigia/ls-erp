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
