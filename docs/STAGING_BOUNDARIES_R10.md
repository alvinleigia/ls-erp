# R10 hosted staging boundaries: teams, offices and partner logins

Phase 6D1 verified on 2026-10-28. All checks targeted the existing isolated QA
tenants on staging. Production, application source, schema and deployments were
unchanged. This is a hosted acceptance checkpoint, not complete ERP UAT or
production approval.

## Candidate and method

The deployed candidate remains `525b8539b968a6858b403e28a48d9de494c5e8b4`, Vercel
deployment `dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`. All three staging aliases point to
that READY deployment. Staging retains 132 applied migrations, zero pending or
rolled-back attempts, and the ordinary non-superuser/non-BYPASSRLS runtime role.
Production remains on `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`.

The runner signed in through the real credential flow and used ordinary hosted
APIs. It created fresh synthetic accounts, profiles, teams, directory entries and
business records; existing QA accounts' grants/settings were not changed. No
hosted SQL fixtures, seeds or resets were used. Chrome contexts were isolated
from the user's browser and `.playwright-auth` was not modified. Passwords and
session cookies were not printed or committed.

The successful run `MVRIGTM6` completed **162 hosted checks**, followed by **80
cleanup checks**. Counts describe API/status assertions, behavioral assertions,
sign-ins and browser checks, not 162 separate end-to-end scenarios. Three browser
captures were visually inspected.

## Verified behavior

### Teams, actions and source access

- A Manager account with no profile grants is denied CRM and project access.
  Job labels do not restore old role-based business authority.
- A manager designated over two teams sees exactly those teams' synthetic
  enquiries and projects. A third team's detail is unavailable. Another tenant
  cannot read the first tenant's team.
- The manager can read team enquiries but cannot edit a member's enquiry when
  Edit is limited to Own. The scoped write returns 404 without changing it.
  Staff can edit their own enquiry; a stale version is rejected with 409.
- A missing Create action is denied despite the Manager label and team role.
  Managers cannot promote members to manager or manage an unrelated team.
- A Staff member sees only their own enquiry and can read the project assigned
  to their team under the explicit Assigned project rule.
- Activity reports show one open activity for each selected managed team. A
  filter for an unmanaged team is denied. Enquiry CSV includes the readable team
  population and excludes the third team's enquiry.
- Removing the manager from one team narrows enquiries and projects immediately
  in the existing session. That team's activity report is then denied. Removing
  the account's profiles also denies both source families without a new sign-in.

### Offices and companies

- A company grant with `includeSubsidiaries: false` exposes only its own office.
  The same grant with the flag true includes its child's office.
- Moving a Staff user's membership away from the initial office hides their
  existing initial-office enquiry, despite its unchanged assignment.
- Self-service office preference changes increment the shared version; an
  administrative save using the old version is rejected with 409.
- Revoking all office grants clears accessible choices and prevents selection
  from the existing session. Restoring the explicit initial-office grant restores
  the original enquiry's visibility. Preference alone never creates membership.

### External logins and attribution

- A new collaborator-linked login starts without business actions or offices.
  Its supervisor supplies neither. Explicit profile and office grants then permit
  only its configured business access.
- Employee-only and internal-team-management actions remain masked even when a
  mixed reusable profile contains them. User-directory and collaborator-directory
  endpoints remain denied. An external login cannot become a Manager or receive
  employee service eligibility.
- A partner-created enquiry records its own collaborator and the saved supervisor
  at introduction. The partner cannot read another employee's enquiry merely
  because that enquiry names the partner as introducer.
- Two enquiries introduced by the same collaborator count as two roots in the
  partner-origin report. Restricting responsible-account type to External counts
  only the one owned by the external login. Introduction and ownership remain
  independent dimensions.
- Archiving the collaborator suspends its login: existing-session reads and a
  fresh credential sign-in are denied. Activation while the collaborator is
  archived is rejected. Restoring the directory entry leaves the login suspended;
  only explicit account reactivation restores sign-in and assigned-record access.

### Browser checks

Desktop Chrome rendered the managed-team detail and collaborator login-management
screens. At a 390-pixel mobile viewport, the manager selected All accessible work
and a specific managed team; the open-activity count was one and its drill-down
link retained the team ID. All three pages had no page-body horizontal overflow
or JavaScript page errors. The workload table scrolls within its container.
The test verified the drill-down link's target; it did not navigate that target.

## Runner corrections and cleanup

Earlier attempts exposed test setup/runner errors rather than an application
change: an assignee lacked office access; a denied scoped edit correctly returned
404; a personal leave rule rejected an unsupported All scope; partner creation
needed an explicit Own assignment-target scope; a generic network-idle wait timed
out; and a rejected sign-in returned a null session. The final runner uses the
canonical grants/statuses and waits for visible controls plus the actual report
response. No permission assertion was skipped and no runtime fallback was added.

All newly created accounts had their explicit profile/office grants removed and
were archived, including the synthetic writer administrator. Test activities were
canceled, enquiries closed, and the created projects/contacts/configuration and
directory records archived. The cleanup of an enquiry owned by a suspended partner
explicitly reassigned that synthetic enquiry to the active QA administrator before
closing it; it did not reactivate the partner or alter introduction evidence.
Two earlier cleanup omissions were repaired through normal APIs and retained in
separate repair receipts. Failed attempts never count as completed acceptance.

Private evidence is under ignored `tmp/industry-release/phase6d/MVRIGTM6`:
`receipt.json`, `created.json`, `cleanup.json` and the three PNG captures. The
phase folder also retains failed-attempt evidence and an independent read-only
cleanup audit across every attempt. That audit verified all seven attempts:
40 accounts archived, all 33 non-admin accounts without profile or office grants,
27 enquiries closed, 15 activities canceled, 12 profiles and 21 teams archived,
and every created company, office, collaborator and lost-reason entry archived.
No raw client records or credentials are in
tracked documentation. Test history remains as archived synthetic data in QA.

## Remaining hosted gates

Next is phase 6D2: quotation/order/receivable transitions, linked financial source
privacy and office boundaries, report/dashboard totals and matching records, plus
their exports. Wider operational acceptance still includes appointments, inventory,
leaves and shifts. Invitation acceptance/expiry, multiple managers on one team,
selected sharing/Restricted visibility and broader browser writes also retain
their prior local/native evidence until exercised explicitly on hosted staging.
Production still requires its own fresh recovery and authorized cutover checks.
