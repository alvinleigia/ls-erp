# Customer Verification activation controls

Step 1, 2026-11-16. Customer Verification is listed under **CRM and sales** in
the shared module controls used by both the platform tenant dialog and tenant
Settings > Modules. The existing creation-time module selector already lists it.

## Activation path

1. Platform administrator: Parent Console > Tenants > the intended tenant's
   actions > Manage modules > CRM and sales > Customer Verification > Allow.
   CRM must already be allowed. Follow the existing allowance behaviour: a newly
   allowed module starts enabled only when its dependencies are active. Repeated
   platform allowance does not override the tenant's later disabled choice.
2. Tenant administrator: Settings > Modules > CRM and sales > Customer
   Verification. Enable/Disable is available only while the platform allows it,
   and enabling requires active CRM. Staff and managers cannot change activation.
3. Once enabled, **Open Customer Verification** links to
   `/settings/verification`. Configure requirements and transaction checkpoints
   there, and assign collection/review access separately through access profiles.

Activation does not publish requirements, create verification cases, approve
customers, grant staff access or enable transaction checkpoints. Fresh tenants
have unpublished requirements and Off checkpoints. Existing saved configuration
is retained when a module is disabled; enabling again is not a reset.

Disabling or removing allowance requires confirmation. The dialog explicitly
warns that existing **Required** transaction checkpoints still apply afterwards.
Module disablement must not become a bypass for published transaction rules.

## Scope and verification

This increment changes shared UI grouping, explanatory text and tests only. It
adds no dependency, database migration, permission backfill or production setting
change. Ewissen activation and business requirement/reviewer choices remain
separate. The private production bucket was provisioned in the previous release.

Local verification: seven module-control browser scenarios, 18 focused unit/source
checks, TypeScript, ESLint and an isolated production build. Desktop/mobile
captures were inspected. Browser coverage includes every registered module being
reachable exactly once across the settings groups, dependency guards, restricted
viewer controls and confirmation/cancel behaviour.

Hosted staging acceptance is `tests/staging-access/verification-activation.spec.ts`.
It uses the guarded P13S fixture with only CRM initially allowed, then exercises
real platform allowance, tenant toggles, settings navigation and revocation through
the UI. It verifies unpublished requirements, Off checkpoints, unchanged other
module flags and denied manager/reviewer access without separate grants. Only a
new synthetic staging tenant is changed. No SQL seed/reset helper runs against a
hosted database. Deployment and final acceptance receipts are ignored under
`tmp/p13s-activation` and `tmp/p13s-staging`.

## Deployment status (2026-11-16)

Implementation is committed and pushed to the staging branch at `98961ff`.
Vercel rejected the explicit staging Git deployment request with HTTP 402:
"Your Team exceeded our fair use limits and has been blocked."
Hosted acceptance has **not run**; no synthetic tenant was created this increment.
The staging alias still points to its earlier deployment, production still points
to `816b25f`, and main is unchanged. No production activation/settings were changed.
The deployment error and final unchanged-alias checks are recorded in ignored
`tmp/p13s-activation` receipts. Resume deployment and then run the guarded hosted
acceptance after the Vercel account restriction is resolved.

## Ewissen access preparation (2026-11-16)

At the user's request, two active but unassigned access profiles were created for
Ewissen through the normal validated, audited access-role service. The hosted
settings API returned Vercel HTTP 402, so the one-off configuration operation used
the existing service directly against the verified production database, with its
tenant/admin checks and native database actor context. This did not deploy code.

- **KYC Collector:** scoped contact/account Read, case Read/Create, own staged
  upload Read/Create/Cancel, and private fact/submission Read/Create (9 grants).
  It does not grant evidence download or review approval.
- **KYC Reviewer:** scoped contact/account Read, case Read, private submission
  Read, evidence download Read and review Read/Approve/Cancel (8 grants).
  It does not grant uploads or submission creation. Existing self-approval guards
  still apply, including when users have additional profiles.

Both profiles contain zero assignments. Existing profiles, user assignments,
record scopes, office/company access, module flags, requirements and checkpoints
were compared within the transaction and preserved. Two normal role-created audit
events were verified, followed by independent readback of saved permissions and
zero assignments. KYC remains inactive. Staff selection and applicable record
scopes must be configured separately before use; requirements remain deferred.
Private configuration receipts are ignored under `tmp/p13s-kyc-profiles`.

## Local upload and independent-review acceptance (2026-11-16)

The user deferred Ewissen requirements and staff assignments, then requested local
upload/review testing. No real client requirements were inferred or published.

- `node scripts/test-sales-orders.cjs --verification --browser`: 177 checks passed,
  zero failures/skips, plus seven Chrome browser scenarios passed. The runner used
  a new disposable loopback PostgreSQL container and removed only that container
  afterwards. Native migration/preservation, forced-RLS, evidence integrity,
  self-approval denial (including administrators), tenant/office/sharing boundaries,
  immutable revisions, correction/approval/revocation, checkpoints, retention and
  disposal checks passed. Browser storage in this suite is an isolated transport.
- A separate new synthetic tenant on `*.localhost:3109` exercised the **real local
  Docker Supabase Storage** service on `127.0.0.1:55446`, with no storage mock.
  Its two profiles exactly matched the nine Collector and eight Reviewer grants
  prepared for Ewissen. Public API upload/finalisation, denied Collector download
  and approval, correction request, corrected submission, independent approval and
  revocation passed. The authorised evidence download matched the uploaded SHA-256.
  Desktop/mobile approved-review screenshots were inspected, as were the isolated
  suite's upload, evidence-reader and revision-history captures.
- The original demo tenant retained KYC disabled; its saved records were not used
  as fixtures. The synthetic live-storage tenant remains for explicit inspection.
  Its private login receipt and result/screenshots are ignored under
  `tmp/p13s-kyc-profiles/local-live`. Do not print or commit its credentials.

No hosted application/database/storage connection, email or gateway payment was
made by these local checks. No application fix, push or deployment was needed.
Suite evidence: `tmp/industry-release/ls-erp-sales-orders-24c042b9445e.log` and
`test-results/local-access/verification-*.png`.

## Simple individual checklist — Step 2 prepared locally (2026-11-16)

The user subsequently approved a simple starting checklist. New, empty and
unpublished requirements show **Use simple individual checklist** to an authorised
publisher. It prepares two editable document categories: `tax_identification`
(Tax identification proof) and `identity_address` (Identity/address evidence).
Each applies separately to PERSON customers and additional customers. No private
fact field, company-buyer requirement, automatic expiry or individual ID-document
mandate is invented. Reviewers decide whether the uploaded tax/identity/address
evidence is acceptable for the transaction; a file upload is not government KYC.

Applying the starter only edits the current browser draft. Explicit preview and
publication still use the existing version/hash/admin checks. The starter is
hidden for readers, published policies, existing choices and unsaved edits, so it
cannot overwrite an existing configuration. No migration or new server endpoint
is needed, and empty global defaults remain unchanged.

Six contract checks and five intercepted browser scenarios passed. A new local
synthetic tenant used the real private Docker Storage bucket: the admin applied,
previewed and published the starter through the UI; primary and additional
applicants each uploaded two originals. Submitting only one category failed;
complete submissions were independently approved, while Collector approval was
denied. Company buyers did not inherit the individual requirements. Checkpoints
remained Off, and the existing demo tenant stayed inactive for KYC. Desktop/mobile
captures were inspected. TypeScript, targeted lint and an isolated production
build passed.

Ewissen's intended draft is saved privately under
`tmp/p13s-simple-checklist/ewissen-requirements-draft.json`. It has **not** been
published to production. Ewissen KYC is still inactive, staff assignments are
deferred, and the activation UI deployment is blocked by Vercel. Do not bypass
these activation/publication controls with a direct policy/flag SQL write.
Native local evidence is under `tmp/p13s-kyc-profiles/local-simple`; intercepted
UI captures are under `test-results/p13s-simple-checklist`.

## Production release verified (2026-11-16)

At the user's instruction to push to production while deferring client staff
assignment, fresh checks found Vercel access restored and the team on Pro.
The application commit is `c107e74a38cdbd023c0940143cae05669d34685d`, pushed to
both main and staging. This UI-only release adds no migrations or permission
backfill. Both hosted builds reported 157 applied migrations and zero newly
applied migrations.

- Staging: READY deployment `dpl_5YsSHbqJTQnVDi1AB8gqZfG5Dsoh`. The guarded test
  in `tests/staging-access/verification-activation.spec.ts` passed (41.2 seconds)
  using only a new labelled synthetic tenant. Platform allowance, tenant
  enable/disable/cancel, requirements navigation, the two-category draft/preview,
  discard without publication and platform revocation all passed. Requirements
  remained unpublished, checkpoints Off, and unrelated module flags unchanged.
  The QA tenant ended with KYC inactive. Screenshots were inspected.
- Production: READY deployment `dpl_9XnpZcX8pUHGkevgz3khsVcZxBCz`. Aliases
  `erp.ewissen.in`, `leiwissen.leigia.com` and `ls-erp-phi.vercel.app` all resolve
  to that exact deployment/source. An existing saved Ewissen administrator
  session passed an authenticated read-only smoke. The module card was present
  and inactive; desktop/mobile screenshots and the profiles screen were inspected.
  All module allowance/enabled flags and all four profile list entries matched
  the pre-release API snapshot, including zero KYC profile assignments. Display
  descriptions were intentionally updated by this release and are not settings.
  KYC requirements still returned 403 while the module is inactive. No business
  mutation was attempted; the browser blocked non-read methods defensively.

Ewissen's module is still inactive, its policy is not published and staff
assignments are left for the client. No transaction checkpoint was enabled or
changed, and no production customer/upload/review/payment record was created.
Deployment and read-only receipts are ignored under `tmp/p13s-simple-release`;
QA credentials remain private under `tmp/p13s-staging`. Screenshots are under
`test-results/p13s-simple-release-staging` and
`test-results/p13s-simple-release-production`. The follow-up hosted test
assertions and release notes form a local evidence checkpoint, without another
application build.
