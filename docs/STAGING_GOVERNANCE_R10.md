# R10 hosted governance acceptance - phase 6D5

Verified on 2026-10-28 using synthetic fixture `QA6G MVRPQ157`. All hosted
writes used normal APIs on the two existing staging QA tenants. This phase
changed no application code or schema, made no GitHub push or deployment, and
made no production write.

The completed receipts contain **274 hosted checks**: 50 team checks, 72
invitation checks and 152 module checks. These are HTTP/status and behavioral
assertions, not 274 separate end-to-end scenarios. Setup has its own 37-check
receipt; cleanup has 68 checks and an independent read-only audit has 86.

## Multiple managers and selected-team reporting

Two managers share Team A; the first also manages Team B. Each team has a
different responsible staff member and enquiry. Their activities have deliberately
different counts: one call in A and two in B.

- Both managers can read Team A's enquiry. The second manager can edit it under
  the explicit Managed Teams grant, and the first sees the updated record.
- Only the first manager sees both teams and both enquiries. The second sees
  only Team A in team and report selectors. Staff Own access exposes only the
  staff member's own enquiry.
- Selected-team reports return the exact one/two-call counts. The second manager
  cannot request Team B's report or enquiry. Foreign-tenant team access is denied.
- A manager cannot promote another user to team manager. A stale membership
  version is rejected.
- Demoting the second manager to ordinary Team A membership immediately removes
  his Managed Teams access, using the same signed-in session. The first manager
  remains unaffected. Restoring authority restores access without signing in again.

These checks exercise shared teams and the existing record adapters. They do not
introduce a CRM-only authorization fallback or grant actions from job labels.

## Invitation acceptance and invalidation

All invitations used Create link delivery for new `example.test` addresses; no
emails were sent. Links and tokens stayed in memory and were excluded from saved
fixture/receipt evidence.

A real mobile Chrome form accepted the invitation, returned HTTP 200 and showed
the sign-in confirmation. The resulting Staff account could sign in and had
exactly its selected profile and office. It received no unowned enquiry records
or user/team administration access. Acceptance did not create a login session.

The checks rejected a duplicate pending invitation with different email casing,
wrong-tenant and malformed tokens, token reuse, a revoked token, an existing
account invitation and deletion of an already accepted invitation. Archiving a
selected profile before acceptance rejected the invitation without creating an
account. A suspended inviter also invalidated the link without creating an account;
the inviter was restored before retiring the fixture.

The initial browser action raced page hydration and issued no acceptance request.
A bounded browser probe waited for the static sign-up page to load, then recorded
the actual POST/200 and confirmation. The pending invitation was reused; no
duplicate account was created. The suspended-inviter test initially expected 403;
the native token-context check correctly returns generic invalid/expired 400.
Only the runner expectation changed. Failed attempts are retained privately.

The hosted API sets a seven-day lifetime; that duration was checked for every
created link. Natural seven-day hosted expiry was not observed or simulated by
backdating hosted data. The existing disposable-local `--invitations` suite
passed **76 tests with zero failures/skips**, including expired/revoked token
rejection and the surrounding onboarding/account boundaries. Its migration
rehearsal reached 132 migrations. The owned test container was removed.

## Module allowance, activation and widgets

QA B's original 12-module settings were saved before changes and restored in a
finally block, then checked independently. QA A's settings remained unchanged.

- A tenant administrator can disable allowed modules in dependency order; ordinary
  staff cannot. Tenant administration cannot change platform allowances or smuggle
  an allowance into an activation request.
- Disabling a parent with active dependents is rejected. Removing its allowance
  while dependent allowances remain is also rejected.
- Every independently routed module denies its API when disabled. Payment Plans
  hides its widget while the parent quotation widget remains available.
- With all modules disabled, every operational visibility flag is false and every
  sales dashboard section is null. Disabled widgets and CRM navigation are absent
  in Chrome, and a direct Services page displays its disabled-module boundary.
  Core team/settings access still works.
- Platform allowance removal prevents tenant reactivation for all 12 modules.
  Dependent modules cannot be allowed before their parents. Reallowing modules
  in dependency order restores the expected activation state.
- A newly saved service retained its exact identity, price and duration across
  both tenant disablement and platform allowance removal/reinstatement.

The mobile invitation confirmation and desktop disabled-dashboard captures were
visually inspected. The dashboard check also verified no body overflow or page
errors. These captures do not certify every module's editing interface.

## Cleanup, source state and remaining gates

The independent 86-check audit verified six archived accounts with cleared
organizational/profile grants, two closed enquiries, three canceled activities,
two archived teams and three archived profiles. The contact, lost reason, office
and company are archived. Both archived invited-user and writer logins are denied.
Only the consumed invitation remains as history; no pending test link remains.

The unreferenced activation-test service and category were removed by their normal
DELETE APIs. Their retained values had already been verified before cleanup. The
first audit incorrectly expected a soft-inactive service; the canonical service
adapter deletes unreferenced services and preserves referenced ones. Cleanup also
needed the lost-reason configuration version. These were utility corrections,
with no application access-rule changes.

The final read-only staging check verified project `oyhsrcmjhwxhvepdbcdc`, all 132
applied migration checksums, no pending/rolled-back attempts and the expected
non-superuser/non-bypass runtime role. The pinned source manifest still matches.
Vercel metadata reads returned HTTP 403; the previously recorded deployment and
alias identities were not freshly certified. Authentication must be renewed
before release metadata or deployment work.

Private evidence is under `tmp/industry-release/phase6d5/MVRPQ157`, with utilities,
receipt hashes and the local test log retained in the existing private staging
checkpoint. No credentials, environment files, invitation tokens or session state
are committed. This checkpoint is not a fresh database backup or standalone
recovery tool.

Next: remaining hosted browser-write and Restricted-sharing paths, followed by
release readiness review. Production still requires fresh recovery verification,
current deployment/alias verification and a separately authorized cutover.
