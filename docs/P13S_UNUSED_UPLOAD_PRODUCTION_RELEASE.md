# P13S unused upload removal: production release

Completed on 2026-11-17. Application access is reopened.

GitHub main and staging were fast-forwarded atomically to
`a18efb109d6b6c5a888a716a93d6907620767309`. Production deployment
`dpl_98p1BDEBFTE6Qb4vTzkJKdA7UNZb` and staging deployment
`dpl_9qJF6Fufxu6eFFyUpfFm6oC7DLqy` are READY at that source. Both databases
have all 159 migrations applied. The three production aliases and staging alias
were verified against their registered projects and deployments.

Application source matches the hosted staging acceptance at `dc68fdd`; the later
commit adds only the acceptance documentation. The prior local verification passed
73 native checks and five browser flows; both hosted staging acceptance scenarios
passed, including the existing crop, duplicate and independent-review workflows.

## Preservation and recovery

Maintenance ran from 10:02:06 to 10:07:50 UTC (15:32 to 15:37 IST). Runtime access
was blocked during backup, migration and deployment checks, then restored to its
captured login and connection settings. No permission grants were changed.

Fresh encrypted backup `87e36e699c12` covers all 180 application tables,
password-free role inventory and six storage objects. Four saved asset references
were verified. A restore on an owned internal Docker network, with no published
ports, passed forced migration rollback and the upgrade from 158 to 159. All
44,014 existing rows across 179 non-history tables, native functions and policies,
role state and readable populations for nine actors were preserved.

Production was compared with the backup before migration. Existing records and
security were checked again after migration and before reopening. Every storage
object was also downloaded read-only and matched the backup byte-for-byte.
The new purpose constraint and two native functions implement unused-upload
eligibility; no existing evidence, submissions, profiles or settings were rewritten.

## Live verification

The existing Ewissen admin session passed authenticated read-only checks for the
dashboard, enquiries, opportunities, verification queue and module settings.
Profiles, module activation, verification policy, checkpoints and retention exactly
matched the pre-release API snapshot. The new eligibility API and management
controls were verified without submitting a removal request.

The shared crop dialog was opened with an unsaved synthetic image and cancelled;
desktop/mobile captures were inspected. No upload, customer, transaction, email or
production deletion was submitted during smoke testing. Soniya's earlier customer
uploads remain untouched; administrators can now remove eligible unused originals
through the audited control described in `P13S_UNUSED_UPLOAD_REMOVAL.md`.

Private release receipts are under ignored `tmp/p13s-unused-release`; encrypted
recovery evidence is under `backups/p13s/87e36e699c12`. Smoke captures are under
`test-results/p13s-unused-production`. Owned rehearsal containers/networks were
removed. Recovery covers application data/security and stored assets, not every
managed Supabase service. Preserve the current disposal ledger when restoring
older backups.

This is a local documentation follow-up; it does not trigger redundant builds.
