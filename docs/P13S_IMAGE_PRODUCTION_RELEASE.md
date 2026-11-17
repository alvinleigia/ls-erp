# P13S image preparation and duplicate removal: production release

Completed on 2026-11-17. Application access is reopened.

## Released source

- GitHub `main` and `staging`: `33bdbe17cd7f0b595656a7379c3e14d9642b683e`.
- Production: `dpl_9VhiJHzwchNid3PrTjhcdLYyrz7R`, READY in registered project
  `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`.
- Staging: `dpl_94ExzhbhNRY5e5mzhMVbH6iC2i2p`, READY at the same source.
- All three production aliases were verified: `erp.ewissen.in`,
  `leiwissen.leigia.com` and `ls-erp-phi.vercel.app`.
- Both databases have 158 applied migrations and none pending.

Application source is identical to hosted staging acceptance `4a94758`; the later
commit adds tests and evidence. Both branches were fast-forwarded in one atomic
push, with no forced update. Their Git integrations produced the deployments;
no duplicate manual deployment was submitted.

This releases optional shared image cropping, exact-duplicate removal controls,
the verification review queue and full revision-history UI. Image preparation
remains local to the browser; no new server image-processing endpoint is added.

## Recovery and preservation

The final maintenance window ran approximately 14:00–14:07 IST. Runtime login and
connections were blocked, then restored to their captured settings. Fresh encrypted
backup `de779e44638d` covers all 180 application tables, password-free role inventory
and six stored files; all four saved asset references were verified.

The backup restored on an owned internal Docker network with no published ports.
Forced rollback and the migration from 157 to 158 passed on that copy. All 44,014
existing rows across the 179 non-history tables and readable populations for nine
actors were preserved. The reviewed disposal function changed and the new duplicate
selector was added. Earlier policies and role state remained unchanged.

Before production migration, the live snapshot was compared with the encrypted
backup. After the actual Prisma migration and again before reopening, existing
records, policies, relation ownership/grants, row-level-security flags, existing
function privileges and role attributes/memberships were checked unchanged.
Existing disposal rows retain their Retention purpose. The runtime still uses a
non-superuser, NOBYPASSRLS role; unscoped reads expose no users.

An initial release-check attempt encountered Supabase's prohibition on the operator
switching into the runtime role. It stopped before migration and automatically
restored runtime access. No grant was added to bypass that restriction. The final
attempt took a new backup and used copied-runtime access tests plus direct live
data/security preservation checks. Both attempts and recovery evidence are retained.

## Live verification

The existing Ewissen administrator session passed authenticated read-only checks
for the dashboard, enquiries, opportunities, verification queue and module settings.
The queue API returned its expected response. Profiles, module activation,
verification requirements, checkpoints and retention exactly match the pre-release
API snapshot.

The crop dialog was opened using an unsaved synthetic image and then cancelled.
Desktop/mobile captures were inspected; there was no horizontal overflow. No upload,
test customer, business transaction, permission edit or outbound email was submitted.
No existing customer file was cropped or automatically deleted. The previously
identified production duplicate was not removed as part of this deployment.

Private receipts are under ignored `tmp/p13s-image-release`; the encrypted recovery
set is under `backups/p13s/de779e44638d`. Captures are under
`test-results/p13s-image-production`. Owned rehearsal containers/networks were
removed. Recovery evidence covers application data/security and stored assets,
not every managed Supabase service. Preserve the current disposal ledger when
recovering older backups.

See `P13S_IMAGE_STAGING_ACCEPTANCE.md` for hosted functional tests. This release
record is a local documentation follow-up; it does not trigger another build.
