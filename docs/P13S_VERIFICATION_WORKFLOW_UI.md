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
