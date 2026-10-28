# R10 consolidated release review - phase 6E

Reviewed on 2026-10-28. **The targeted technical review passed.** The reviewed
application was ready for a production-release decision. At that checkpoint,
production remained unchanged; this review did not authorize a push, maintenance freeze, migration
or deployment. The execution steps are in [the R10 cutover runbook](PRODUCTION_CUTOVER_R10.md).

Subsequent phase 6F completed the [production release](PRODUCTION_RELEASE_R10.md)
under the user's explicit approval, with fresh recovery and live verification.

## Current identities

| Target | Freshly verified state |
| --- | --- |
| Application candidate | `525b8539b968a6858b403e28a48d9de494c5e8b4`; subsequent changes through review HEAD `68f8584` are documentation only |
| Staging | Project `prj_zZjjsQX2pp1qVz7vE2FrmZWU8rM0`; READY deployment `dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`, candidate above; all three project domains match |
| Production | Project `prj_GZCH9YiGANSZ2FGdg50E1TbdGzsX`; READY deployment `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`, commit `adcffc892cfca57fdace3377a18d38887de56853`; all three project domains match |
| Staging database | `oyhsrcmjhwxhvepdbcdc`: 132 applied migrations, zero pending or rolled-back attempts |
| Production database | `tehtbbifiimoplzlewzs`: 107 applied migrations in 108 history rows; 25 pending and one retained rolled-back attempt |
| Runtime role | Both projects: `prisma_app` has LOGIN, connection limit -1, no superuser or BYPASSRLS |
| GitHub | Both `main` and `staging` still point to `160becb79d10b112ea1364b3b66c300fc808eeb9`; both are ancestors of the tested candidate |

Migration histories match the pinned source checksums and contiguous-prefix
rules. The rolled-back production attempt must remain in history. The exact
final release commit must be recorded again after committing this review.

The Vercel verification blocker is resolved: authenticated CLI API reads succeed.
The older direct-token helper returned 403 and is excluded from current identity
verification. No manual reauthentication or hosted configuration change was
needed. Git-created and CLI-created deployments expose their commit in different
native metadata fields; both identities were explicitly verified.

## Acceptance evidence

| Phase | Completed checks | Principal coverage |
| --- | ---: | --- |
| [6C](STAGING_RELEASE_R10.md) | 45 | Staging migration, deployment and initial hosted boundaries |
| [6D1](STAGING_BOUNDARIES_R10.md) | 162 | Teams, offices, profiles and external collaborator logins |
| [6D2](STAGING_FINANCIAL_R10.md) | 229 | Quotation/order/receivable transitions, privacy, reporting and exports |
| [6D3](STAGING_OPERATIONS_R10.md) | 168 | Appointments, purchase receipts, source-office stock and concurrent sales |
| [6D4](STAGING_WORKFORCE_R10.md) | 36 completed recovery checks | Leaves/Shifts final-state checks, browser captures and immediate revocation; its earlier 172-check API checkpoint is separate, incomplete receipt evidence |
| [6D5](STAGING_GOVERNANCE_R10.md) | 274 | Multiple managers, invitation acceptance/invalidation and all 12 activation controls |
| [6D6](STAGING_SHARING_R10.md) | 188 | Actual mobile edits, Restricted sharing, action bounds and linked source privacy |

Counts include HTTP assertions, resumed segments and repeated reads. They are not
unique end-to-end scenarios and must not be used as an exhaustive coverage claim.
The separate 76-test disposable-local invitation/account suite includes natural
expiry logic; seven-day hosted expiry was not observed by waiting or backdating.
Each phase documents its capture, recovery and remaining scope limits.

Completed cleanup audits were checked for every phase. Phase 6D1's independent
audit covers all seven fixture attempts. Later audits verify retired accounts,
cleared grants, resolved activities/orders/leaves/stock and retained historical
documents. Phase 6D4's initial `cleanupPending` assertion receipt is superseded
by its successful cleanup and independent audit, not treated as cleanup evidence.

## Recovery and environment review

Both retained encrypted recovery sets were authenticated again offline:

- Pilot `backups/r10/b9dd5d7fd416`: database archive hash/length matched; database,
  role and source archives decrypted in memory; two storage objects authenticated.
- Staging `backups/staging-r10/7d4122d54c10`: the same archive checks passed and
  eleven storage objects authenticated.

The prior ownership/ACL-preserving isolated restore receipts remain valid. This
review did not perform another restore or certify complete Supabase recovery.
The pilot-copy upgrade receipt verifies 107 to 132 migrations, seven existing
accounts, 42 resource-read decisions and 459 exact account/record bindings. It
retains the managed-service and ICU differences described in the recovery pages.

These snapshots are historical. Matching migration history or object counts does
not prove current client data matches the snapshot. A fresh consistent backup,
storage capture, isolated restore/upgrade check and reconciliation are required
at the production release boundary.

Required database/auth/root-domain/storage environment keys are configured in the
appropriate Vercel project environment. Secret values were not revealed or
compared with local files. Read-only authentication-provider checks verified the
correct origin on both public hosts. Production has no fixed `AUTH_URL` or
`NEXTAUTH_URL`; that is compatible with its verified host-derived behavior and
must not be replaced with staging's URL. The review's initial fixed-URL
requirement was corrected without editing any environment setting.

Read-only storage inventory currently finds two production branding objects and
no production document objects; staging has eight branding and four document
objects. These inventory counts are not a fresh backup or byte comparison. No
email delivery was certified; hosted invitations used supported Create link delivery.

## Release decision and remaining work

No new application defect or feature implementation is required by the completed
targeted acceptance. Remaining work is release execution:

1. Approve the production release and maintenance window, including the Git push
   that triggers production deployment and its effect on every tenant.
2. Pin the final commit, recheck targets and writer inventory, and retain the
   existing project-specific environment configuration.
3. During the agreed window, stop writers, establish the verified runtime freeze,
   take fresh recovery artifacts and pass their restore/upgrade/reconciliation checks.
4. Apply the 25 reviewed migrations, publish the exact approved commit, verify
   the READY deployment and every production domain, then reopen and smoke-test
   existing pilot access read-only.

No cutover step was executed here. The generic source checker continues to leave
release approval false; this evidence review does not silently override it.
Private hashed receipts are under `tmp/industry-release/phase6e` and the existing
private staging checkpoint. Credentials, client rows, environment values and
browser state are excluded from committed documentation.
