# P13S - Participant verification and transaction checkpoints

Local implementation, 2026-11-11. No hosted migration, deployment, activation,
profile assignment or Ewissen business data change accompanies this milestone.

## Behaviour

Customer Verification now provides a separate, status-only Verification tab on
opportunities and sales orders. It lists each selected person/business and role.
The `verificationSummaries.read` capability also requires ordinary source Read,
company/office access, record scope and sharing. It exposes no private facts,
files, review reasons or reviewer identities. External logins are excluded.

Opportunity summaries follow current selected participants. Order summaries and
checkpoints use the participants frozen in the accepted quotation/order snapshot;
later CRM edits never silently replace them. Unresolvable historical identities
fail verification rather than falling back to today's customer selection.

Settings > Customer verification has Requirements and Transaction checkpoints
tabs. Only a tenant administrator with the corresponding capabilities can publish
previewed, sequential checkpoint settings. Existing tenants default to Off.

| Action | Off | Warn | Required |
| --- | --- | --- | --- |
| Confirm sales order | Existing behaviour | Proceed, retain result | All applicable applicants must be verified |
| Allocate held unit | Existing behaviour | Proceed, retain result | All applicable applicants must be verified |
| Issue a new order document | Existing behaviour | Proceed, retain result | All applicable applicants must be verified |

Primary customer verification is always included when checks are enabled.
Additional customers are included by default; representatives can also be selected.
Published verification requirements are needed before enabling Warn or Required.
Begin with Warn during tenant onboarding and review the effect before requiring it.
There is no automatic module activation or grant migration.

Each role uses its own latest submission and latest decision. A new revision in
one role cannot revive that role's older approval or invalidate another role's
independent approval. Review still uses the global case revision token to reject
stale changes. Current policy, expiry, revocation, archived subjects and module
activation are evaluated using database time and fresh authority. Disabling the
module cannot bypass Required rules already published.

## Accepted evidence and existing flows

The native database action atomically mints an immutable acceptance record for
Warn/Required. It retains configuration version, actor/time, saved participant
identities and the exact submission/review/policy references and outcome accepted
at that action. It contains no identity values, file names/paths or correspondence.
Direct fabricated proof inserts and subsequent updates/deletes are rejected.
Status-only users see a compact latest-ten-action history, not the raw proof.

Document issuance checks before rendering/storage and again before commit. Its
prepared fingerprint binds the verification state; changed approvals/settings or
expiry during rendering invalidate the attempt and clean an unused stored object.
An already completed idempotent retry and an existing issued PDF download remain
available. Earlier documents and accepted evidence are not rewritten on revocation.

Recording money already received remains available independently of verification.
There is no new gate on payment recording, reservation release/cancellation,
historical document retrieval, receipt issuance or statutory invoice issuance.
The checkpoint applies to all registered sales-order document providers, including
generic acknowledgements and Real Estate booking/allotment letters. It uses the
shared platform engine; the Real Estate module is not needed for generic sales.

## Native migration and verification

`20261111000300_verification_checkpoints` adds two empty forced-RLS tables and
bounded native source/status projections. It also updates the review guard to
select the latest submission for the reviewed role. Earlier migrations remain
unchanged. Existing records, module flags, profiles and private originals are
preserved. Historical migration verification checks forced rollback and exact
contents of every preceding business table.

Automated coverage includes Off compatibility, all three checkpoints, Warn proofs,
Required atomic denial/success, two applicants, independent roles, frozen versus
current participants, expiry/revocation/policy changes, private projections,
record/company/office/team/tenant/external boundaries, direct native enforcement,
immutable proofs, optimistic publication, payment independence and issuance races.
The browser flow uses a disposable loopback database, a non-bypass application
role and synthetic customers; it configures Required, verifies status-only access,
approves both applicants independently, confirms the order and allocates the unit.

Final verification passed:

- 150 verification/access/storage/recovery checks, including 17 checkpoint cases.
- 53 existing catalog/order/reservation/document integration checks. Catalog writes
  now take the same tenant lock and operational mutex as reservations before fresh
  authorisation. Repeated simultaneous hold/edit attempts accept exactly one writer
  and return a normal 409 for the other. The old participant snapshot expectation
  was updated to include existing saved correspondence, without changing production
  snapshot behaviour.
- Five production-build browser flows: requirements administration/read-only access,
  private uploads/downloads, submission/review/corrections and checkpoint operation.
  Desktop/mobile settings and participant captures were visually inspected; no page
  overflow was found. A validity timestamp timezone issue found during inspection
  was corrected and covered by native instant-offset assertions.
- Historical forced-rollback/reapply rehearsal preserved all 173 preceding tables
  exactly, with the two new tables empty and no tenant activation/access backfill.
- Production build, TypeScript, targeted ESLint and Git whitespace checks passed.

The older single-office test factories run separately with their explicitly guarded
historical fixture bridge (`--verification-regression`). Verification/office-isolation
tests run without that bridge. This is test setup only; no production fallback or
temporary permission override was introduced.

Ignored evidence logs: `tmp/p13s-partner/checkpoints-complete-final.log`,
`checkpoints-regression-corrected.log`, `checkpoints-rehearsal-final.log`,
`checkpoints-browser-release-final.log` and `checkpoints-final-build.log`.
Screenshots: `test-results/local-access/verification-checkpoints-*.png`.

Retention scheduling, legal holds, accepted-original disposal and operational
review queues remain subsequent P13S work. Accepted originals remain retained;
the abandoned-upload cleanup does not delete accepted evidence.
