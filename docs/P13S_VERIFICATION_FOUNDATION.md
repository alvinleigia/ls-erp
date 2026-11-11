# P13S customer verification foundation

Follow-up: private evidence collection is now implemented locally; see
[P13S private evidence](P13S_PRIVATE_EVIDENCE.md). The pending list below records
the boundary at the original foundation milestone.

Verified locally, 2026-11-11. Branch: staging. Not committed, pushed or deployed.
This is a foundation milestone within CUSTOMER_VERIFICATION_PLAN.md, not a
complete KYC collection/review release.

## Delivered

- Separate Customer Verification module, default off, currently requiring the
  shared CRM customer directory. Nothing activates it for existing tenants.
- Settings > Customer verification: required-fact/document tabs, labels/codes,
  Text/Date/Email/Country fact types, person/business and participant-role choices,
  bounded approval validity, preview then publication and saved feedback.
  Policy readers can inspect both tabs; only tenant administrators can publish.
- Immutable policy versions. Preview binds tenant/version/definition; stale or
  changed publication fails. Concurrent publication accepts one current version.
  No private customer facts appear in previews or general audit.
- Shared case service with native person/business references and a CRM adapter.
  Co-applicants are separate subjects. Concurrent starts reuse one case.
  Cases return Not started/In progress only. No fabricated Verified state or
  historical approval is created. The initial policy reference is immutable.
- Separate verificationPolicies Read/Edit and customerVerification Read/Create.
  Collection also requires canonical customer Read, scope and sharing. It does
  not require policy-directory access. Manager roles and ordinary directory
  readers receive no new authority. External collaborator logins stay excluded.
- Forced native RLS, tenant-bound composite FKs, native definition validation,
  immutable owner/history guards and current policy/actor guards. Mandatory
  application audit is in the same transaction; audit failure rolls back writes.

## Verification

- 129 distinct automated checks across the existing 109-check CP/access/report/
  financial suite and 20 new verification contract/native checks. The first
  combined run covered 125; four additional native scenarios were then added
  and the complete 20-check verification suite passed.
- Historical `--verification` runner: 49 checks passed (a subset of the above).
  Migration rollback and exact contents/counts of all 167 preceding tables were
  preserved. Module flags, profiles, scopes and customer data were not backfilled.
- Two production-build browser workflows passed: administrator configuration,
  preview invalidation/publication, case start/idempotency, default-off denial,
  and policy-reader inspection without publish/collection authority.
- Desktop/mobile screenshots inspected; no horizontal page overflow on mobile.
- Production build, TypeScript, targeted ESLint and whitespace checks passed.

Repeat with Docker Desktop running:

```powershell
node scripts/test-sales-orders.cjs --verification
# Build first for the optional native browser workflows:
npm.cmd run build
node scripts/test-sales-orders.cjs --verification --browser
```

These runners create disposable loopback databases and synthetic tenants. They
do not load hosted database credentials. Browser fixtures use isolated sign-ins.

Ignored local evidence:

- tmp/p13s-partner/verification-regression.log
- tmp/p13s-partner/verification-native-final.log
- tmp/p13s-partner/verification-rehearsal.log
- tmp/industry-release/ls-erp-sales-orders-ac59b02297bd.log
- tmp/p13s-partner/verification-browser.log
- test-results/local-access/verification-foundation-desktop.png
- test-results/local-access/verification-foundation-mobile.png

## Pending and release boundary

Next: private original-file storage with staged upload/finalisation, content/size
validation, authorised download, cleanup and customer/account Verification tabs.
Then: versioned submissions, independent reviewer/evidence permissions, protected
history, expiry, reusable eligibility/proofs and retention/recovery.
No approval endpoint, evidence upload, expiry scheduler or transaction gate is
available in this milestone. Starting a case does not approve anyone.

Booking confirmation, allocation, document issuance and payment recording remain
unchanged. No identity numbers/files/paths are added to CIF snapshots, analytics
or PDF tags. No disposable business entries were created in Ewissen.

A future deployment must include the prior delegated-partner migration and this
new migration in order, with the standard backup/release checks. Keep this module
off for live tenants until collection/review acceptance is complete and activation
is requested. Grant future evidence/review actions explicitly through profiles;
never use account-role fallbacks or retroactive mandatory booking checks.
