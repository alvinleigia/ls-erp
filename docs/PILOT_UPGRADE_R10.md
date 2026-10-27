# R10 pilot-copy upgrade and access comparison: phase 6B2

Verified locally on 2026-10-28 against the protected pilot backup
`backups/r10/b9dd5d7fd416/`. No hosted database, storage object or deployment was
changed. The application was not started against the copied client data.

## Corrected baseline

The pilot has **107 applied migrations**, not 108. Its 108 history rows contain
one rolled-back attempt of `20261024000100_flexible_team_intake` and its successful
attempt. There are **25 pending migrations** in the 132-migration candidate.
The phase 6B1 report counted attempts as applied migrations; its data/restore
verification remains valid. Original artifacts are retained, with a separate
`history-summary-correction.json` explaining the corrected counts.

`summarizeHistory` in `scripts/release-readiness-r10.cjs` now distinguishes history
rows, successful unique migrations and rolled-back attempts. It first validates a
contiguous reviewed prefix and rejects unknown, modified, missing, duplicate or
unresolved entries. A regression exercises 108 attempts / 107 applied / 25 pending.

## Representative isolated environment

The fresh copy retained application ownership/ACLs and source role membership
provenance using the already verified recovery procedure. It ran on PostgreSQL
17.11 with the ICU locale provider, `en-US`, and `en_US.UTF-8` collation/ctype.
Both migration operator and runtime role matched the source privilege boundary:
the operator has BYPASSRLS but is not superuser and cannot SET ROLE to the managed
administrator; `prisma_app` is neither superuser nor BYPASSRLS.

All **six actual managed DDL event-trigger definitions**, owners, event kinds,
tag filters and enabled states were reviewed and copied without stub replacements.
They remained unchanged after deployment. None of the pending migrations creates
or drops an extension; an extension-DDL change would fail this rehearsal admission
check and require additional environment preparation. PostgREST notifications
remain inside the disposable database; no external services or workers run.

The ICU collation versions differ: source **153.121**, local **153.128**. The
environment is therefore not certified identical, and full Supabase services,
Vault and extension workloads are not reproduced. This result covers the tested
data, policies and queries; hosted text-search/order behavior and full workflows
still require staging acceptance.

The database used an internal Docker network, no published ports and temporary
database storage. Only read-only code mounts were supplied to the internal test
worker. The owned container and network were removed after every attempt.

## Migration and preservation checks

Actual `prisma migrate deploy` applied **25 migrations**, using the source-equivalent
non-superuser operator. History then contains **132 successful migrations and the
one original rolled-back attempt: 133 rows**. Every original history row retains
its ID, timestamps and contents; no history repair or `migrate resolve` was used.

The comparison retains the original values from **all 117 prior tables** in
memory and checks IDs, assignments, saved contents and timestamps after migration.
It maps the two deliberate team-table renames and projects the old columns when
checking new office/sharing/partner columns. Profile/assignment additions and the
documented custom-field classification conversion have separate explicit checks.
Originally empty business tables remain empty. No fixtures, seeds, resets or
ordinary business writes run against the copied client data.

Additional assertions verify:

- Original table ownership/ACLs survive, including renamed teams; global role
  attributes, memberships and settings remain unchanged.
- Every existing business user gets exactly the initial-office policy/grant,
  with no implicit company-wide grant. Each tenant gets its initial company/office.
  Native sales roots retain the initial office and existing individual project
  memberships remain unchanged.
- All **five Staff/Manager policies** have the expected **870 resource/action
  rules**. Their five profile assignments and permission arrays exactly match the
  reviewed frozen account-access translation. These are ordinary persisted grants;
  the runtime receives no legacy-role fallback.
- Existing employment rows retain their saved values and the declared approval
  routing translation. Three workplace placements are backfilled to the initial
  office with open dates and no canceled assignment.
- No record becomes newly shared or Restricted; sharing policies/grants remain
  empty. Projects do not gain a team assignment. No account becomes an external
  collaborator and no existing sales source gains invented partner attribution.

## Account read-access comparison

The oracle uses the recorded production source revision
`160becb79d10b112ea1364b3b66c300fc808eeb9`, which has the matching 107-migration
inventory. The later recorded hosting-only release uses this baseline and changes
packaging/routing. The saved CLI login returned HTTP 403 during phase 6B2, blocking
a fresh live Vercel revision check. Phase 6C subsequently renewed the login and
verified the exact live production revision
and hosting-only difference; see [staging checkpoint](STAGING_RELEASE_R10.md).

Before migration, the probe executes the baseline's own CRM, activity and project
record predicates; after migration it executes the candidate predicates with fresh
profile/rule resolution. Both sides use the ordinary `prisma_app` role, transaction-
local tenant/actor identity and explicit ID-only queries. Baseline pure exported
project/work predicates are extracted from their original TypeScript declarations;
their logic is not rewritten into a new policy oracle. No application compatibility
branch or old-mode adapter was added.

**Seven existing accounts** were compared over enquiries, opportunities, contacts,
accounts, activities and projects: **42 resource-read decisions and 459 account/
record bindings** match exactly. Deliberate foreign-tenant reads also return no
records without relying on a caller-supplied application predicate. Platform and
other denied entrypoints retain their boundary.

This verifies these readable populations and the explicit action-rule/profile
translation. It does not claim that all business edits, reports, exports, dashboards
or UI flows were exercised using pilot records. Operational and financial families
with no pilot rows retain the separate synthetic/native test evidence from earlier
phases. Full hosted staging flows remain required.

## Evidence and next gate

Completed private receipt: `upgrade-1793130187527-receipt.json` in the protected
backup folder. It records baseline/final history summaries, preservation results,
read-population counts, operator/runtime bounds, environment differences and tool
digests. The environment inventory is encrypted as `environment.enc`. One-off
utilities are retained privately for review; no client rows or credentials are
committed. Failed attempts are not completion evidence.

Source/history/storage unit checks and changed-tooling ESLint/whitespace checks
are separate from this pilot-copy result. No deployment or push occurred in phase
6B2. Phase 6C has since verified the live revision and completed the staging
release and initial hosted checks; wider acceptance remains. Production requires
a separately authorized release with a fresh cutover backup.
