# P13S - Retention review and preservation holds

Local implementation, 2026-11-11. This increment provides retention decisions and
reasoned hold/release history. It does not enable disposal or an automatic purge.
No hosted settings, files, access profiles or Ewissen records have been changed.

## Retention settings

Settings > Customer verification > Retention publishes previewed, immutable policy
versions. Blank means indefinite retention, including the unpublished default.
An administrator may configure 1–36,500 days from original-file acceptance for
unreferenced accepted evidence. There is no universal statutory period built in;
the tenant configures its business obligations. A shorter period changes review
eligibility only and never removes anything automatically.

The separate verificationRetention Read/Edit capabilities govern settings.
Publication and individual evidence retention review also require a real tenant
administrator. Individual review additionally requires private evidence Read,
case Read and the canonical customer/account source access. A non-admin policy
reader can inspect configuration without gaining private evidence or disposal
review access.

## Case preservation holds

Customer/account > Verification > Retention and holds provides a case-wide
preservation instruction for accepted verification records. One active instruction
protects that person/business across its transactions. Hold placement and release
are separate verificationHolds Create/Cancel capabilities, with explicit Read,
case Read and canonical source scope. These can be delegated to an internal
custodian without granting evidence downloads, private fact access, review approval
or retention publication. External logins are excluded.

Both placement and release require a private reason. Release has an explicit UI
confirmation and does not override retention or saved references. Actor, database
time and sequential version are immutable. Stale or concurrent requests cannot
silently replace an instruction. The latest ten events are displayed; earlier
events remain retained. Ordinary audit stores case/version/action only, never the
private reason. The tab is loaded on first use and preserves draft wording when
switching subtabs; changing customer clears the draft.

Holds concern accepted evidence and submissions. Pending/abandoned uploads have
never been accepted and continue to follow their separate expiry cleanup policy.
Placing a hold does not validate identity, share records or block money recording.

## Read-only eligibility

The administrative case review lists at most twenty accepted originals. Statuses
use the database clock and this precedence:

1. Active preservation hold: retain.
2. Any accepted transaction proof referencing the case: retain all case originals.
3. Any saved submission selecting the original: retain, including pending,
   superseded or revoked submissions.
4. Indefinite or unpublished policy: retain.
5. Retention period not reached: retain until its end.
6. Otherwise: eligible for a future disposal review.

No status means deletion has occurred or is authorised. Accepted files, immutable
identity metadata, typed facts, reviews, transaction proofs and issued PDFs retain
their existing protections. Downloads and verification/checkpoints are unchanged.
Changing retention or releasing a hold never revives an approval or alters a PDF.

The review batches bounded file decisions into one database request. Private file
names are only returned to administrative evidence readers. Native projections
deny foreign tenants, external/non-admin callers, missing grants and disabled KYC.
Hold reads/writes also enforce canonical source RLS and Restricted visibility.
Native rejected-row errors are sanitised before the general API logger.

## Migration and acceptance

Migration `20261111000400_verification_retention_holds` adds two empty forced-RLS
tables: VerificationRetentionVersion and VerificationHoldEvent. It extends the
closed verification permission resolver for the new capabilities, without changing
prior role assignments, scopes, module flags, cases, evidence or business records.
No earlier migration is edited.

Tests cover indefinite/default and finite policies, exact clock/instant handling,
immutable versions/history, preview binding, concurrent/stale actions, separate
release permission, person/business independence, original preservation, private
audit/error redaction, source/Restricted/tenant/external boundaries, module/grant
revocation, failed-audit rollback, submission and transaction reference protection.
The browser flow configures retention, accepts an original, places/releases a
hold, verifies a delegated custodian's limits and preserves the file. All fixtures
are synthetic and use a disposable loopback database, never the pilot tenant.

## Verification results

Final verification passed: 162 automated checks (including eleven retention/hold
cases and eighteen checkpoint cases), six production-build browser flows, build,
TypeScript, targeted ESLint and whitespace. The historical forced-rollback/reapply
rehearsal preserved all 175 preceding tables exactly; both new tables were empty
and no module/grant backfill occurred. Desktop/mobile settings and hold panels
were inspected. A mobile subtab clipping issue and incorrect nesting of the new
panel were corrected before the final passing browser run. Mobile navigation and
draft preservation are included in that test.

Ignored evidence: `tmp/p13s-partner/retention-complete.log`,
`retention-rehearsal.log`, `retention-browser-final.log` and
`retention-final-build.log`. Captures are under
`test-results/local-access/verification-retention-*.png`. Repeat with
`node scripts/test-sales-orders.cjs --verification --browser` after a build;
the runner creates and removes its own guarded disposable database.

## Subsequent controlled-disposal milestone

The local implementation now adds the separately confirmed, quarantined disposal
workflow described in `P13S_VERIFICATION_DISPOSAL.md`. The results above describe
this earlier read-only milestone. No automatic purge is enabled.

## Remaining work at this milestone

Controlled disposal needs its own reviewed workflow, rechecked references/holds,
durable storage failure recovery and minimal tombstones. Referenced facts and files
remain retained until those rules are explicitly implemented and approved. No
deletion endpoint, background scheduler, service-role bypass or purge is provided
here. Backups retain their own expiry; immediate erasure from backups is not claimed.
Operational review queues and combined hosted staging acceptance remain later P13S
work before controlled production rollout.
