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
