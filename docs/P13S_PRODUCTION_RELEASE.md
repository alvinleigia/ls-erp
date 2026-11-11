# P13S production release — 2026-11-11

Production release completed and application access reopened.

## Released source and recovery

- GitHub `main`: `816b25f38b3f1f20edead60189c98517468a5987`.
- Vercel deployment: `dpl_5BnhvyjdS9Lg1YGBMZgrBzsN8NzQ`, READY in the registered
  production project. `erp.ewissen.in`, `leiwissen.leigia.com` and
  `ls-erp-phi.vercel.app` all resolve to this deployment.
- Runtime application source matches the verified staging application `ccb486a`;
  the intervening commits contain test/evidence/release-preparation changes.
- Maintenance ran from approximately 11:09 to 11:33 IST. The original runtime
  login and connection limit were restored, preserving NOBYPASSRLS/non-superuser
  configuration. Unscoped runtime access still returns no users.
- Final encrypted backup: `ba8e102c99f8`, captured after the runtime block. Its
  isolated restore, forced rollback, seven-migration upgrade and copied-user
  access checks passed before production migration. Four storage objects and
  both saved asset references were authenticated. No ports were published, and
  all owned rehearsal containers/networks were removed afterwards.

## Database and Ewissen access

All seven P13S migrations applied, from 150 to 157. The historical rollback
attempt remains recorded. Exact comparison preserved all 40,525 baseline rows
across 167 tables; 13 added tables were empty with forced row-level security.
The migration did not rewrite client records, attribution, assignments or module
activation. See the source manifest and readiness document for SQL/recovery scope.

Soniya's existing Booking & Collections profile and record policy were updated
together in one serializable transaction through the normal versioned access
service as an active Ewissen tenant administrator. The one-off release operator
used the explicit production operator connection while normal login remained
blocked; it did not add application bypass code or directly patch permission rows.

The profile now has 41 permissions, adding the four reviewed CP choice/link
actions. Existing relevant sales, project-read, quotation, order, document,
receivable and collection scopes now cover All accessible records. Her Manager
role, office grants and Restricted-record boundaries are preserved. Other users,
profiles and business rows were checked unchanged. The two expected access audit
events were verified. KYC approval, private evidence, user/CP-directory
administration, document-template editing and refund/cancellation authority were
not added.

## Live verification

The restored production runtime login passed fresh native read-only checks under
Soniya's actor context: all four partner scopes resolve correctly, choices expose
only the bounded fields, and private verification access remains inactive.

Using the existing saved Ewissen administrator login, the live dashboard summary
returned 200; the opportunity pipeline, new-opportunity CP selector and module
settings loaded. Desktop and mobile captures were inspected. The browser runner
was tightened to await loaded data rather than capture loading states. The final
five-view run passed with no attempted/submitted business writes. No test client,
opportunity, booking, payment, identity file or outbound email was created.

## KYC activation remains separate

The private production `tenant-verification` bucket is provisioned and verified:
5 MiB limit, PDF/JPEG/PNG only, non-public. Ewissen's verification module remains
unconfigured/inactive. No requirements, checkpoint, retention, review or hold
configuration was published; the new tables remain empty.

Before activation, agree requirements and collector/independent-reviewer access,
then test the complete UI activation path on staging. The module-settings group
registration must include Customer verification before presenting that activation
flow to administrators; do not bypass the UI gap by directly changing production
flags. Checkpoints remain Off and accepted-original retention defaults indefinite.

Private evidence is retained under ignored `tmp/p13s-production` and
`backups/p13s/ba8e102c99f8`; screenshots are under `test-results/p13s-production`.
This application-schema/role/storage recovery proof does not certify recovery of
every managed Supabase service.
