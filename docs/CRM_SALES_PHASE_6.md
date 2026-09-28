# Phase 6 - Internal CRM sales regression and release readiness

Scope clarified by the user on 2026-09-28: use the existing CRM testing leads.
This is internal testing, not a client-requested pilot. No fresh client dataset,
legacy import, or client sign-off is required for this step. Payments, bookings
and documentation remain outside the CRM/sales implementation scope.

## Existing test business

Target: `https://crm-test.salon.leigia.com`.
The default linked-browser target still points to the platform administrator at
`https://salon.leigia.com`; that is not the business used for these checks.
The separate existing-record configuration leaves the default target unchanged.
Saved admin and staff logins were verified against the exact CRM Test tenant and
their expected roles. Credentials/cookies are never included in test sources.

Existing records used:

- Alex Taylor and Private Test Contact.
- Quotation request enquiry and its already-converted, won opportunity.
- Taylor business deal (open) and Test lost deal (lost).
- Admin-only test, completed Staff handoff test and the completed retry chain.

`tests/crm-existing/fixture.ts` identifies these synthetic records explicitly.
The suite reads them; it does not seed, reset, reassign, complete or resave them.
Do not redirect this fixture to a different business or real customer dataset.

## Repeatable checks

```powershell
# Existing deployed CRM regression; no business writes.
npm.cmd run test:crm:existing

# First pre-upgrade capture only (refuses to overwrite an existing baseline).
$env:CRM_CAPTURE_BASELINE='1'
npm.cmd run test:crm:existing
Remove-Item Env:CRM_CAPTURE_BASELINE

# After migration/deployment, BEFORE making further business changes:
$env:CRM_EXISTING_BASELINE='test-results/crm-existing-baseline.json'
npm.cmd run test:crm:existing
Remove-Item Env:CRM_EXISTING_BASELINE

# New feature availability; missing deployment is a failure, never a skip.
npm.cmd run test:crm:release
```

The baseline and screenshots contain test business data and remain in ignored
`test-results/`. Keep the pre-upgrade JSON through deployment. It compares
existing scalar record values, links, timestamps, versions, schedules, outcomes
and reminder fields; additive new fields are allowed. It is regression evidence,
not a database backup or an import file. New legitimate business edits can change
the baseline; investigate differences instead of overwriting it to force a pass.

Private defaults are `.playwright-auth/performance-session.json` for CRM Test
admin and `.playwright-auth/staff-session.json` for staff. Override with
`CRM_ADMIN_STORAGE_STATE` / `CRM_STAFF_STORAGE_STATE` when saving fresh logins.
Follow BROWSER_TESTING.md if sessions expire; never put passwords in the suite.

Checks include:

- Existing conversion identity and one opportunity per source enquiry.
- Open/won/lost deal states and retained amount/currency.
- Staff can still read their completed handoff activity; private contact,
  enquiry, opportunity and admin-only activity remain hidden.
- Staff cannot request a team activity report.
- Admin mine/team and staff mine completion/open totals reconcile with all
  paginated work, by activity type and call outcome.
- The third generated retry remains completed and has no fourth child.
- Contact and staff activity detail/timelines render on desktop/mobile in
  light/dark mode, without page overflow or unexpected failing API requests.
  Completed standalone staff work does not retain access to every customer
  conversation: the shared-history 404 and its explanatory UI message are
  explicitly expected. The staff member's own work history remains readable.
- Release gates for managed lead sources, optional Real Estate registration,
  sales report rows and scoped CSV exports.

## Deployed versus local status

Verification completed on 2026-09-28:

| Check | Result |
| --- | --- |
| Existing-record browser/API suite | 13 passed; 1 intentional skip (admin-only baseline is not duplicated for staff) |
| Baseline comparison against capture | Passed; no existing records modified by the suite |
| Visual inspection | All 8 desktop/mobile and light/dark screenshots inspected; no clipped controls or horizontal page overflow |
| Contact timeline next/previous | Passed against the existing 11 interaction records |
| New-feature release gates | 3 failed: lead-source endpoint absent, Real Estate module absent, sales-report endpoint absent |
| Local TypeScript and targeted ESLint | Passed |

Screenshots and the existing-data report are in `test-results/crm-existing/` and
`playwright-report/crm-existing/`. Release failures are kept separately in
`test-results/crm-release-gates/`; they do not overwrite baseline evidence.

On 2026-09-28, the hosted CRM Test business still serves the earlier CRM release.
Lead sources, Real Estate projects and sales reporting endpoints return 404;
`/api/modules` lists CRM but not Real Estate. Phases 2-5 remain locally verified,
as recorded in their phase documents; they are not verified on these hosted leads.
An existing-record regression pass does not override the failed release gates.

Current activity report baseline for 2026-09-01 through 2026-09-28, Asia/Kolkata:
admin has 1 open and 10 completed; staff has 0 open and 1 completed. The admin's
10 completed calls have 4 CONNECTED and 6 NO ANSWER outcomes. Team completions
include the staff member's call. These are dated observations, not fixed counters
that should be maintained by changing business records.

## Remaining sequence using the same records

1. Prepare a reviewed release containing the Phase 2-5 changes. Use the existing
   deployment process and retain a database backup/restore point. Do not run
   local fixtures or reset scripts against the hosted database.
2. Apply the additive migrations in order using the migration connection:
   `20260928120000_crm_lead_intake`, `20260928160000_real_estate_projects`,
   `20260928190000_real_estate_sales`. Deploy the matching generated client and
   application. No new data migration is introduced by Phase 6.
3. Run the existing-record comparison and all release gates. Stop on changed
   historical values, lost links, missing routes or permission regressions.
   Preserve schema/data on application rollback; do not undo additive migrations
   by deleting columns/tables that might now contain sales work.
4. Enable Real Estate only for CRM Test, leaving generic CRM businesses unchanged.
   Verify Alex and the existing records still open before adding property context.
5. Create one clearly named test project/subproject and a managed test source.
   Edit Taylor business deal to select that project and source; refresh/reopen
   to verify persistence. Keep the already-won Quotation request intact.
6. Exercise project change and manager-to-staff handoff on the open Taylor deal,
   check old/new access and audit history, then schedule and complete a MEETING
   site visit with a reminder using the same Alex contact. These are deliberate
   next-round test mutations, not actions performed by the read-only suite.
7. Verify conversion defaults without reconverting the already-converted enquiry.
   If a fresh conversion is needed, create one labelled test enquiry under Alex,
   then convert once; do not create another contact or overwrite the historical
   quotation. Recheck reports, filters and CSV totals against the actual results.

The earlier intermittent local activity-plan concurrency result remains a tracked
regression concern (see Phase 5); existing-record reads do not claim to retest
concurrent writes. Repeat its isolated integration scenario before release and
investigate a recurrence, rather than adding retries that hide a defect.

## Coverage and deferred work

| Acceptance area | Evidence and next action |
| --- | --- |
| S01-S04 identity, capture, ownership, sources/referrals | Core existing identity/access checked hosted; intake, duplicate and handoff mutations verified locally in Phase 2. Recheck new controls after deployment. |
| S05 project context | Phase 3/4 local coverage; hosted module unavailable. Use the same Taylor deal after deployment. |
| S06 calls/site visits/reminders | Existing call outcomes, retry chain, staff handoff and reminders retained; new project visit scenario pending deployment. |
| S07 conversion | Existing enquiry-to-won-deal link checked hosted; property context and concurrent conversion covered locally in Phase 4/5. |
| S08 sales results | Existing open/won/lost states checked; configurable property pipeline covered locally. |
| S09 continuity | Existing detail/timeline layouts checked; baseline retains versions, ownership, schedules and summaries. |
| S10 reports | Hosted activity totals reconcile; new sales reporting remains behind deployment gate. |
| S11 export/import | Scoped exports tested locally in Phase 5; hosted export gate pending. Import excluded by the user's clarification. |
| S12 post-sale | Deferred. No booking, reservation, payment or document is created by marking a deal won. |

For future post-sale handoff, CRM remains the source of sales ownership, contact,
opportunity and interaction history. The existing application remains the source
of application/booking IDs, inventory commitments, documents and collections.
Use the CRM contact/opportunity identifiers plus the existing application's record
identifier in any reviewed handoff. Automated reference mapping/synchronization
is not implemented in this release. Do not imply that a won amount is money received.

Phase 6 remains open until the new deployment and the remaining tests on these
records pass. No client acceptance or full replacement of the old system is claimed.
