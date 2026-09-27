# Linked browser testing

This follows ls-chatbot/LIA's Chrome + Playwright saved-login workflow. The default
site is **https://salon.leigia.com**. No application deployment or database setup
is required for the browser connection.

## Use

```powershell
npm.cmd run browser:open
# Sign in yourself in the dedicated Chrome window.
npm.cmd run browser:save
npm.cmd run browser:status
npm.cmd run test:browser:connection
npm.cmd run test:browser
```

Tell Codex "I'm signed in; test the browser" after signing in. Codex can save the
session and run these commands. The connection check covers the authenticated
dashboard. The full suite also covers CRM overview, My Work, activity plans,
follow-up rules, and a mobile rule form. It reads pages and edits only an unsaved
form; it does not save business changes. CRM checks require the corresponding
application version to be deployed and CRM enabled for the selected business.
Missing features or disabled CRM fail clearly rather than being reported as tested.

Use `npm.cmd run test:browser:headed` to watch the suite, or
`npm.cmd run test:browser:report` to view the HTML report. Screenshots are saved
under `test-results/browser`; failures also retain a Playwright trace. Screenshots
are evidence for visual inspection, not pixel-baseline assertions.

To select another local/staging business:

```powershell
npm.cmd run browser:open -- http://storefront1.localhost:3000
# Sign in, then browser:save again.
```

The launcher records the resolved origin, including HTTP-to-HTTPS redirects.
Saving the session records the authenticated user and tenant; tests check both
before using it. Expired logins require signing in and saving again. `browser:open`
clears the saved target identity, so always run `browser:save` afterwards.

## Codex connection

Chrome uses this project's dedicated `.playwright-auth/chrome` profile and exposes
CDP only at `http://127.0.0.1:9223`. It leaves normal browser profiles and LIA's
profile untouched. Keep that Chrome window open for interactive Codex testing.
Closing it stops the interactive connection; saved-session tests can still run
until the login expires.

Codex can attach with the installed Playwright library:

```javascript
const { chromium } = require("@playwright/test")
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223")
const context = browser.contexts()[0]
// Inspect context.pages(), then use the target app's page and visible locators.
// Disconnect after the task; do not close the user's page/context.
await browser.close()
```

The repeatable test suite launches separate Chrome contexts from the saved login,
so it does not navigate the user's open tab. This is a project Playwright
connection; it does not register a new MCP tool or require a Codex restart.

Authentication files, browser profiles, screenshots and traces are Git-ignored.
Do not commit or share `.playwright-auth` or print its cookies/tokens. Authentication
is stored separately from test output so report cleanup cannot delete the login.
Use the dedicated profile for this app only. `CRM_BROWSER_EXECUTABLE` can override
the Chrome executable path if Chrome is installed elsewhere.

References: [Playwright authentication](https://playwright.dev/docs/auth) and
[connecting over CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).

## Setup verification

On 2026-09-27, the dedicated Chrome launcher successfully connected on port 9223
and opened `https://salon.leigia.com`. TypeScript, targeted ESLint and Git whitespace
checks passed. Authentication/profile files and browser reports are Git-ignored.
Authenticated browser tests are pending the user's login and session capture;
the hosted CRM pages have not yet been visually verified through this setup.

## Manual UAT — tenant provisioning, 2026-09-27

The user signed in as the platform administrator; the session was saved locally.
The platform console initially listed no business tenants. Creating `CRM Test`
then returned `Unable to provision tenant.`

The actual API handler reproduced this error against an isolated PostgreSQL
database with a non-bypass application role: `new row violates row-level security
policy for table "User"`. Authorization succeeded, but the async authorization
helper's ambient database context did not propagate back to the route. Tenant
creation now runs inside an explicit, authorized RLS-bypass callback. Tenant
listing uses the same explicit scope so related user counts remain accurate.

Six integration tests pass, covering creation with settings and audit, duplicate
admin detection, unauthorized callers, organization scope, failed-transaction
rollback and absence of bypass leakage. Only authentication is stubbed; the real
route, authorization, Prisma adapter and database policies run. TypeScript and
targeted ESLint also pass. Run with `npm.cmd run test:tenants:integration` and
`CRM_TEST_DATABASE_URL` pointing to the prepared disposable local database.

The fix needs application deployment before retrying the hosted Create tenant
flow. No hosted business records were created or altered during reproduction.

## Manual UAT — new-business dashboard, 2026-09-27

After the provisioning fix was pushed, the user created `crm-test`, signed in as
its business administrator and saw `Unable to load dashboard summary.` A
read-only execution of the dashboard handler against that tenant reproduced
Supabase's `EMAXCONNSESSION` error: its session pool permits 15 clients, while
the previously unbounded base application pool could open ten connections for
the dashboard's parallel queries. The base pool now respects `RLS_POOL_MAX`,
matching scoped clients (default one connection in production, two locally).
This caps each pool, not the aggregate across server instances; deployment
concurrency and the database's total connection budget must still agree.

The dashboard also now runs its queries inside an explicit tenant context, so
RLS permits its own settings and records without revealing other businesses.
The browser connection test requires a successful summary API response, rather
than accepting a rendered dashboard shell that displays an error.

All four dashboard integration tests and six tenant-provisioning regressions
passed, as did TypeScript and targeted ESLint. Coverage includes empty-business
responses, concurrent tenant isolation, session rejection and a one-connection
budget during parallel reads. The corrected handler returned HTTP 200 against
CRM Test using read-only queries. This verifies local corrected code against the
hosted database; the deployed UI still needs retesting after deployment.

## Manual UAT — settings and embedded activities, 2026-09-27

The enquiry activity panel showed `Unable to complete this request`, alongside
HTTP 500 responses from `/api/settings`. The settings GET and PATCH handlers now
explicitly scope database work to the authorized tenant. Previously, RLS hid the
existing settings and rejected the attempted replacement. Regression tests cover
initial working hours, settings edits, tenant isolation and rejected sessions.

Concurrent activity reads reproduced a separate transaction acquisition timeout:
with the production one-connection pool, Prisma's default two-second wait expired
while other page panels were loading. CRM transactions now allow a bounded
20-second acquisition wait, retaining the existing 20-second execution limit and
connection budget. A local regression holds the connection for three seconds to
verify that queued work succeeds. Eight concurrent read-only requests against
Supabase changed from five successes and three failures to eight HTTP 200s using
the corrected local handler. Hosted business data was not changed by diagnostics.

Run the focused tests with `npm.cmd run test:settings-work:integration` and the
guarded disposable `CRM_TEST_DATABASE_URL`. All five focused tests and four
dashboard regressions pass. The CRM suite adds 68 passing tests, with one legacy
upgrade-fixture test skipped on this fresh schema. TypeScript and targeted ESLint
also pass. Hosted
browser verification still requires deployment and a page refresh; these results
do not claim that the deployed UI has been visually verified.

## Hosted latency — function/database region alignment, 2026-09-27

Authenticated hosted reads showed approximately 3.2–3.4 seconds for enquiries
and 4 seconds for reminders, even sequentially. Response routing headers showed
`bom1::iad1`: requests entered in Mumbai but executed in the US. The configured
Supabase session pool is in `ap-south-1` (Mumbai). Multiple database round trips
across regions also lengthened connection queues when page panels loaded together.

`vercel.json` now selects `bom1` for server functions, matching the database.
This is an application-wide deployment setting, independent of the business's
display time zone. It leaves database isolation and connection limits unchanged.
If the database moves regions, update this setting with it. Vercel documents
[function region configuration](https://vercel.com/docs/functions/configuring-functions/region)
and recommends locating functions near their data source.

Verification uses authenticated read-only HTTP requests against the hosted app;
the test administrator's saved login remains in the ignored authentication folder.
Compare routing headers and repeated warm request timings after deployment,
including concurrent enquiries and reminders. Cold starts may remain slower.

Deployment was verified live: routing changed to `bom1::bom1`. All 27 authenticated
HTTP checks returned 200 across enquiries, reminders, contacts, opportunities,
pipelines and activity reports. Repeated warm sequential reads took 89–193 ms;
enquiries took 100–105 ms versus 3.2–3.4 seconds before, and reminders 108–110 ms
versus 4 seconds. Three concurrent reads previously took 5.7–8.5 seconds each;
the two subsequent warm rounds took 109–723 ms. Initial samples remained slower
(up to 1.2 seconds sequentially and 2.7 seconds in the first concurrent round), so
these measurements do not imply a guaranteed latency or a cold-start fix. The
deployment configuration was validated and Git whitespace checks passed; no
application code or database migrations changed in this fix.

## Conversion-page failure — shared transaction pooling, 2026-09-27

The opportunity conversion form and reminders failed together. Read-only hosted
requests reproduced HTTP 500s across enquiries, assignees and pipelines. The
underlying error was `EMAXCONNSESSION`: Supabase's session pool allowed only 15
connections. A one-connection limit per tenant pool did not bound connections
across tenants and server instances; idle sessions still occupied database slots.

Runtime now uses Supabase's shared transaction pool and a single application pool
per process. Existing shared Supabase pooler URLs on port 5432 map to 6543 at
runtime; migration URLs are unchanged. Tenant and platform Prisma clients retain
separate scopes but share physical connections. The adapter applies both tenant
and bypass settings transaction-locally, including for standalone queries, so a
pooled backend cannot carry a previous tenant's context into the next operation.
No RLS policy or migration is changed. See [Supabase setup](SUPABASE_SETUP.md).

Six focused database tests cover concurrent tenant/platform/unscoped reads using
one backend, rollback, batch transactions, rejected cross-tenant writes, failed
bypass queries, invalid identifiers, client disposal and physical reconnection.
Fifteen API regressions and 68 CRM unit/integration tests pass (one legacy-upgrade
fixture test is skipped on this fresh database). Eight concurrent read-only CRM
requests also returned 200 through the corrected local runtime against Supabase
while the old deployed session pool was saturated.

The production build, TypeScript and targeted ESLint pass. The authenticated HTTP
workflow also passes against the built app and disposable database, exercising
real sign-in, enquiry conversion, CRM writes, staff access, plans and rules with a
one-connection runtime pool. Total: 90 passing tests/checks, plus the one skipped
legacy-upgrade fixture test. Run focused pooling tests with
`npm.cmd run test:tenant-pool:integration` and the guarded local test database.

After deployment, a separate saved-session Chrome context loaded the real
conversion form without saving. All nine observed CRM/settings requests returned
200, and the inspected screenshot confirmed the enquiry title, contact, assignee,
currency and description were populated with no application error. The business
has no selected pipeline, so Save remains disabled until one is configured.
Three further rounds of five concurrent preload requests all returned 200
(warm rounds 115–342 ms; initial round 748–1153 ms). A generic alert-count
assertion encountered Next.js's empty accessibility announcer; inspecting its
text and the form confirmed this was not an application error. The default
browser suite was not reported as passed. No hosted opportunity was created.
