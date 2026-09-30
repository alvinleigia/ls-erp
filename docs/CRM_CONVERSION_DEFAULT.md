# Default enquiry conversion stage

Implemented locally on 2026-09-29; hosted migration/deployment pending.

Managers and administrators can open a pipeline, edit **Pipeline configuration**,
and select **Default conversion stage**. Choices contain active OPEN stages and
**Automatic (first active open stage)**. This works for newly added stages too.
The saved overview displays the selection.

Converting an enquiry prefills that pipeline's selected stage and its probability.
Changing pipelines selects the new pipeline's default. Salespeople can override
the selection before saving. Direct opportunity creation still starts in the
first active OPEN stage; saved opportunities keep their existing stage.

Reordering or renaming stages preserves the choice. Removing an unsaved stage,
archiving the selected stage or changing its outcome resets the form's choice to
Automatic. Server validation rejects multiple, archived or closed defaults.

Migration `20260929210000_crm_conversion_default` adds a default-false flag to
CrmStage, a check constraint for active OPEN defaults, and a partial unique index
on tenant/pipeline. Existing stages and opportunities are preserved. No additional
read query is needed: pipeline detail already returns its ordered stages.
Configuration writes retain tenant scoping, manager checks, version conflicts and
auditing. Defaults are switched atomically inside the existing transaction.

Apply the migration before deploying the application. No hosted database or
business configuration was changed during implementation.

## Local verification

- 28 CRM unit/boundary tests passed (`npm run test:crm`).
- Two isolated PostgreSQL tests passed: actual incremental migration preservation
  and constraints; service persistence, clearing/switching, permissions, tenant
  isolation, invalid updates, stale versions, existing opportunity preservation
  and audit creation.
- Two intercepted browser tests passed: dropdown selection/reordering/save/reload/
  clearing, conversion stage/probability, manual override and direct creation.
- Pipeline edit-panel screenshot inspected; TypeScript, targeted ESLint, Prisma
  validation and Git whitespace checks passed.

Database checks require a disposable local `ls_salon_crm_test` database prepared
by `scripts/prepare-crm-test-db.cjs`, with `CRM_TEST_DATABASE_URL` set explicitly:

```powershell
node --require ./tests/register.cjs --test --test-name-pattern='conversion default persists|conversion migration preserves' tests/crm.integration.test.cjs tests/crm-conversion-migration.test.cjs
npx playwright test --config playwright.project-ui.config.ts --grep 'pipeline conversion default|enquiry conversion prefills'
```
