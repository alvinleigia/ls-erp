# P13S verification workflow UI

The customer verification panel separates collection, review and file management.
This is a presentation change: API payloads, stored documents, immutable submissions,
review separation, retention and removal permissions remain unchanged.

- **Documents:** choose a document type and file, optionally crop an image, then
  upload. Transfer progress stays next to the upload action. Server validation is
  a separate stage. Successfully uploaded documents are not customer approvals.
- **Details & review:** use Continue to details & review, complete the configured
  facts, select the supporting documents and submit. An independently authorised
  reviewer approves or requests corrections. Switching tabs preserves draft facts.
- **File management:** authorised users manage preservation instructions; internal
  administrators can remove eligible originals using the existing guarded flow.
  Inactive holds and retention details are collapsed. Active holds open visibly.
  Advanced cleanup is explicitly business-wide, requires confirmation, and only
  cleans expired unfinished uploads. Stored customer documents are retained.

Labels distinguish Collecting documents from Awaiting review and Verified. Users
without review visibility receive no verdict. Collectors without evidence Read
receive no stored filename, download or misleading zero count. Upload cleanup
administrators retain their existing action even without permission to read holds.

The shared panel covers person and business-account verification across industries.
No migration, tenant activation, profile change or production data write is needed.

Validation uses the production build and the focused verification runner:

```powershell
npm.cmd run build
node scripts/test-sales-orders.cjs --verification-crop --browser
```

New browser scenarios cover collector permissions, draft preservation, submission,
self-approval prevention, cleanup cancellation/confirmation, preservation of stored
originals and collector access boundaries. Existing image preparation,
private evidence, submission/review, retention and removal flows run alongside them.

Verified on 2026-11-17: production build, TypeScript, targeted ESLint and whitespace
checks passed, alongside 67 native checks and all 14 local browser flows. The first
browser run found an outdated status-label assertion and an invalid test assumption
that an administrator could receive a restricted profile. The label was updated
and the unsupported scenario removed; native administrator safeguards were retained.
The final browser-only rerun passed all 14 flows. Local evidence is under
`tmp/p13s-verification-ui/` and `tmp/industry-release/ls-erp-sales-orders-1d1a36a554a2.log`.

Source `f66654ab8d8dec5bd1ed45fe98e2f753d2ce0b3f` is READY on staging deployment
`dpl_HARY6EKY3jBERMMnuKirjW2thMP7`. Both hosted acceptance tests passed using
owned synthetic staging tenants and real private storage: crop/validation/progress,
duplicate and unused removal, saved-submission protection, replacement, independent
corrections and approval. Desktop/mobile captures were inspected. Hosted evidence
is in `tmp/p13s-verification-ui/staging.log` and `test-results/staging-access/`.
The production alias still points to `dpl_6dW9a4R9rQjMgGNxUS2tAjcF6Wze`.
This increment is staging-only; no production settings, grants or records changed.

## Production release

Released on 2026-11-17. The staging-only statement above records the earlier
acceptance milestone. GitHub main/staging were fast-forwarded atomically to
`e351a64dd0e80b486a9d9a452cf3bccc198941c3`. Application/test code matches the
tested staging source exactly; later changes only recorded acceptance.
Production `dpl_4dLeTyXmvWEQfeR1LpNqc1ogAEeF` and staging
`dpl_4AeRx1CMy6c22uygpTpuuS5G9ABT` are READY at that source. All three production
aliases and the staging alias resolve to their expected projects/deployments.

No maintenance, database migration, storage change or access-profile change was
needed. Both databases have 159 verified applied migrations and none pending.
The previous production deployment remains available for a code rollback.

Authenticated Ewissen smoke passed dashboard, enquiries, opportunities, verification
queue and modules, followed by the new Documents/Details & review/File management
navigation, next-step button and cancellation of the business-wide cleanup
confirmation. Local image selection/cropping, preview dimensions and immediate
12 MB rejection still work. Desktop/mobile captures were inspected without
horizontal overflow. Upload selection was cleared without uploading; all mutating
browser requests were blocked throughout the smoke check.

Modules, access profiles, verification policy, checkpoints and retention match
the pre-release read-only snapshot. No production document or business record was
changed. Private release receipts are under `tmp/p13s-verification-ui/production/`
and captures under `test-results/p13s-verification-ui-production/`. This local
release-record follow-up does not trigger another deployment.
